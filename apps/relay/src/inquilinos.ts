/**
 * El padrón: los restaurantes que atiende el relay, y sus credenciales.
 *
 * Es lo ÚNICO que el relay guarda. Ni comandas, ni ventas, ni clientes: eso vive
 * en el local de cada restaurante y ahí se queda (TRD R3). Aquí solo está lo
 * mínimo para saber a quién le toca un mensaje y con qué llave mandarlo.
 *
 * POR QUÉ IMPORTA QUE SEA TAN POCO
 *
 * El relay es la única parte de MotRest expuesta a internet. Si algún día lo
 * comprometen, lo que se llevan son credenciales de WhatsApp —revocables en un
 * clic desde el panel de Meta— y no la operación de cincuenta restaurantes.
 * Esa asimetría es deliberada y es lo que hace defendible tener algo en la nube.
 *
 * EL PADRÓN ES LA FUENTE DE VERDAD, NO UN EFECTO SECUNDARIO
 *
 * Antes un restaurante entraba solo: el Hub se conectaba, mandaba `credenciales`
 * y quedaba dado de alta. Era confiar en el primero que llegara, sin la parte de
 * confiar. Ahora **MOTRAE da de alta explícitamente** (`padron alta`), el relay
 * devuelve una credencial que solo se enseña una vez, y un Hub sin credencial en
 * el padrón no existe para el relay. El Hub sigue pudiendo publicar SU número de
 * WhatsApp —eso lo decide el restaurante en Meta, no MOTRAE— pero solo dentro de
 * la ficha que ya se le abrió.
 *
 * Y EL ARCHIVO VA CIFRADO
 *
 * Dentro hay tokens de la API de Meta: con uno se manda WhatsApp en nombre del
 * restaurante. Un respaldo mal guardado, un disco que se devuelve al proveedor o
 * un `docker cp` distraído no pueden ser suficientes. La llave va en el entorno
 * (`MOTREST_RELAY_LLAVE_PADRON`), nunca junto al archivo.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generarCredencial, huellaCoincide, huellaDe, type Destino, type Inquilino } from "./nucleo.js";

/** Enlace vivo con el Hub de un restaurante. */
export interface EnlaceHub {
  sucursal_id: string;
  enviar(mensaje: unknown): void;
  /** Corta el enlace. Se usa al dar de baja al restaurante. */
  cerrar(): void;
}

/** Lo que puede pasar cuando un Hub publica su número de WhatsApp. */
export type ResultadoWhatsApp = "actualizado" | "sin-cambios" | "ajeno";

/** El sobre cifrado tal y como queda en disco. */
interface SobreCifrado {
  v: 1;
  iv: string;
  tag: string;
  datos: string;
}

/**
 * Convierte lo que venga en `MOTREST_RELAY_LLAVE_PADRON` en 32 bytes.
 *
 * Se exige base64 de 32 bytes exactos y **no** se acepta una frase corta
 * derivada al vuelo: una llave débil aquí no da ningún error visible, cifra
 * igual, y solo se descubre el día que alguien la rompe.
 */
export function llaveDelPadron(valor: string | undefined): Buffer {
  const llave = Buffer.from(valor ?? "", "base64");
  if (llave.length !== 32) {
    throw new Error(
      "MOTREST_RELAY_LLAVE_PADRON debe ser 32 bytes en base64. " +
        "Genera una con: pnpm --filter @motrest/relay padron llave",
    );
  }
  return llave;
}

function cifrar(texto: string, llave: Buffer): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", llave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const sobre: SobreCifrado = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    datos: datos.toString("base64"),
  };
  return JSON.stringify(sobre);
}

function descifrar(sobre: SobreCifrado, llave: Buffer): string {
  const descifrador = createDecipheriv("aes-256-gcm", llave, Buffer.from(sobre.iv, "base64"));
  descifrador.setAuthTag(Buffer.from(sobre.tag, "base64"));
  return Buffer.concat([
    descifrador.update(Buffer.from(sobre.datos, "base64")),
    descifrador.final(),
  ]).toString("utf8");
}

export class Inquilinos {
  private porNumero = new Map<string, Inquilino>();
  private porSucursal = new Map<string, Inquilino>();
  /** Índice por huella de credencial: es como se autentica un Hub. */
  private porHuella = new Map<string, Inquilino>();
  /** Hubs conectados ahora. Un restaurante puede tener el suyo apagado. */
  private enlaces = new Map<string, EnlaceHub>();

  constructor(
    private ruta: string,
    private llave: Buffer,
    private avisar: (texto: string) => void = () => {},
  ) {
    this.cargar();
  }

  private cargar(): void {
    if (!existsSync(this.ruta)) return;
    let crudo: string;
    try {
      crudo = readFileSync(this.ruta, "utf8");
    } catch (causa) {
      // Un archivo ilegible no puede impedir que arranque el relay de TODOS:
      // se avisa y se sigue con lo que se pueda.
      this.avisar(`No se pudo leer el padrón de restaurantes: ${String(causa)}`);
      return;
    }

    let lista: Inquilino[];
    try {
      const contenido = JSON.parse(crudo) as SobreCifrado | Inquilino[];
      if (Array.isArray(contenido)) {
        /*
         * Padrón viejo, en claro. Se acepta una vez y se vuelve a escribir
         * cifrado en el acto. Reventar aquí dejaría sin WhatsApp a todos los
         * restaurantes por un formato de archivo.
         */
        this.avisar("Padrón en claro: se migra a cifrado.");
        lista = contenido;
        for (const i of lista) this.indexar(this.normalizar(i));
        this.guardar();
        return;
      }
      lista = JSON.parse(descifrar(contenido, this.llave)) as Inquilino[];
    } catch (causa) {
      // Casi siempre es la llave equivocada. Decirlo así ahorra una hora.
      this.avisar(
        `No se pudo descifrar el padrón (¿MOTREST_RELAY_LLAVE_PADRON es la correcta?): ${String(causa)}`,
      );
      return;
    }

    for (const i of lista) this.indexar(this.normalizar(i));
  }

  /**
   * Rellena una ficha vieja para que no falte nada.
   *
   * Un inquilino sin `credencial_sha256` viene del auto-registro de antes: se
   * carga para no perder su número de WhatsApp, pero **con la huella vacía**, y
   * `porCredencial()` no lo devuelve nunca. Traduce a: sigue enrutando lo que
   * entra, y su Hub no se puede conectar hasta que MOTRAE lo dé de alta de
   * verdad. Es exactamente el efecto que se busca.
   */
  private normalizar(i: Inquilino): Inquilino {
    return {
      sucursal_id: i.sucursal_id,
      phone_number_id: i.phone_number_id ?? "",
      token: i.token ?? "",
      nombre: i.nombre || i.sucursal_id,
      credencial_sha256: i.credencial_sha256 ?? "",
      alta_ts: i.alta_ts ?? 0,
    };
  }

  private indexar(i: Inquilino): void {
    this.porSucursal.set(i.sucursal_id, i);
    // Sin número no se indexa para enrutar: la cadena vacía como clave haría
    // que un webhook sin `phone_number_id` cayera en un restaurante al azar.
    if (i.phone_number_id) this.porNumero.set(i.phone_number_id, i);
    if (i.credencial_sha256) this.porHuella.set(i.credencial_sha256, i);
  }

  private desindexar(i: Inquilino): void {
    this.porSucursal.delete(i.sucursal_id);
    if (i.phone_number_id) this.porNumero.delete(i.phone_number_id);
    if (i.credencial_sha256) this.porHuella.delete(i.credencial_sha256);
  }

  /**
   * Escribe el padrón entero, cifrado y de golpe.
   *
   * **Temporal + `rename`**, que en los dos sistemas es atómico: un corte de luz
   * a media escritura dejaba antes el padrón de todos los restaurantes en un
   * JSON truncado, y el relay arrancaba sin nadie. Con esto, o está el padrón
   * viejo entero o está el nuevo entero.
   *
   * `0600` desde el primer momento —incluido el temporal, que si no queda con
   * los permisos por defecto durante el instante que vive.
   */
  private guardar(): void {
    const carpeta = dirname(this.ruta);
    mkdirSync(carpeta, { recursive: true, mode: 0o700 });

    const temporal = join(carpeta, `.padron-${process.pid}-${Date.now()}.tmp`);
    try {
      writeFileSync(temporal, cifrar(JSON.stringify([...this.porSucursal.values()]), this.llave), {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporal, this.ruta);
      chmodSync(this.ruta, 0o600);
    } catch (causa) {
      try {
        if (existsSync(temporal)) unlinkSync(temporal);
      } catch {
        /* si tampoco se puede borrar el temporal, no hay nada más que hacer */
      }
      throw causa;
    }
  }

  /** El mapa que usa el enrutador. Solo lectura. */
  get mapa(): ReadonlyMap<string, Destino> {
    return this.porNumero;
  }

  de(sucursalId: string): Inquilino | undefined {
    return this.porSucursal.get(sucursalId);
  }

  /** Todo el padrón, para el CLI. Sin tokens: no hay motivo para enseñarlos. */
  lista(): { sucursal_id: string; nombre: string; whatsapp: boolean; alta_ts: number }[] {
    return [...this.porSucursal.values()].map((i) => ({
      sucursal_id: i.sucursal_id,
      nombre: i.nombre,
      whatsapp: Boolean(i.phone_number_id),
      alta_ts: i.alta_ts,
    }));
  }

  /**
   * ¿De quién es esta credencial?
   *
   * **La sucursal sale de aquí y de ningún otro sitio.** Antes el Hub declaraba
   * su `sucursal_id` en el saludo y el relay se lo creía: con una sola clave
   * compartida, cualquier local podía decir que era otro y quedarse con sus
   * mensajes entrantes. Ahora la identidad es una consecuencia de la credencial,
   * y una credencial solo la tiene su dueño.
   */
  porCredencial(credencial: string): Inquilino | undefined {
    if (!credencial) return undefined;
    const huella = huellaDe(credencial);
    const candidato = this.porHuella.get(huella);
    if (!candidato) return undefined;
    return huellaCoincide(candidato.credencial_sha256, huella) ? candidato : undefined;
  }

  // --- Alta y baja (solo MOTRAE) --------------------------------------------------

  /**
   * Da de alta un restaurante y devuelve su credencial **en claro, una vez**.
   *
   * No se guarda en ningún sitio: si se pierde, se rota. Es a propósito — un
   * padrón que puede recordar la credencial es un padrón que puede filtrarla.
   */
  darDeAlta(sucursalId: string, nombre: string): string {
    if (this.porSucursal.has(sucursalId)) {
      throw new Error(`La sucursal ${sucursalId} ya está en el padrón. Usa "rotar" si perdiste la credencial.`);
    }
    const credencial = generarCredencial();
    this.indexar({
      sucursal_id: sucursalId,
      phone_number_id: "",
      token: "",
      nombre: nombre || sucursalId,
      credencial_sha256: huellaDe(credencial),
      alta_ts: Date.now(),
    });
    this.guardar();
    return credencial;
  }

  /**
   * Credencial nueva para un restaurante que ya está de alta.
   *
   * Se corta el enlace vivo: si la credencial se rota es porque la vieja ya no
   * es de fiar, y dejar conectado a quien entró con ella sería rotarla a medias.
   */
  rotarCredencial(sucursalId: string): string {
    const previo = this.porSucursal.get(sucursalId);
    if (!previo) throw new Error(`La sucursal ${sucursalId} no está en el padrón.`);

    const credencial = generarCredencial();
    this.desindexar(previo);
    this.indexar({ ...previo, credencial_sha256: huellaDe(credencial) });
    this.guardar();
    this.enlaces.get(sucursalId)?.cerrar();
    this.enlaces.delete(sucursalId);
    return credencial;
  }

  /** El restaurante deja MotRest: se olvidan sus credenciales de inmediato. */
  darDeBaja(sucursalId: string): boolean {
    const previo = this.porSucursal.get(sucursalId);
    if (!previo) return false;
    this.desindexar(previo);
    this.enlaces.get(sucursalId)?.cerrar();
    this.enlaces.delete(sucursalId);
    this.guardar();
    return true;
  }

  // --- Lo que el Hub sí puede cambiar ---------------------------------------------

  /**
   * El Hub publica el número de WhatsApp de SU restaurante.
   *
   * Tres cuidados, y los tres vienen de un fallo real:
   *
   * 1. **Solo dentro de su propia ficha.** El Hub ya está autenticado y su
   *    sucursal sale de la credencial, así que no puede tocar la de otro.
   * 2. **Un `phone_number_id` que ya es de otro se rechaza.** Sin esto, un local
   *    reclamaba el número de otro y se llevaba sus mensajes entrantes: el
   *    índice `porNumero` se lo habría reasignado sin decir nada.
   * 3. **Si no cambió nada, no se escribe.** El Hub reenvía sus credenciales en
   *    cada reconexión —que es lo correcto, así se recupera solo si el relay se
   *    reinstala—, y antes cada reenvío era una escritura síncrona del padrón
   *    completo. Un Hub en bucle de reconexión bastaba para castigar el disco de
   *    todos los restaurantes.
   */
  publicarWhatsApp(
    sucursalId: string,
    cred: { phone_number_id: string; token: string; nombre?: string },
  ): ResultadoWhatsApp {
    const previo = this.porSucursal.get(sucursalId);
    if (!previo) return "ajeno";

    const dueno = this.porNumero.get(cred.phone_number_id);
    if (dueno && dueno.sucursal_id !== sucursalId) return "ajeno";

    const nombre = cred.nombre || previo.nombre;
    if (
      previo.phone_number_id === cred.phone_number_id &&
      previo.token === cred.token &&
      previo.nombre === nombre
    ) {
      return "sin-cambios";
    }

    this.desindexar(previo);
    this.indexar({ ...previo, phone_number_id: cred.phone_number_id, token: cred.token, nombre });
    this.guardar();
    return "actualizado";
  }

  // --- Hubs conectados ------------------------------------------------------------

  /**
   * Registra el enlace vivo de un Hub. `false` = ya había uno.
   *
   * **Se rechaza el segundo en vez de reemplazarlo.** Antes `conectar()`
   * sobrescribía sin cerrar el anterior, y bastaba con eso para que el intruso
   * se quedara los mensajes del local; peor todavía, al desconectarse el intruso
   * borraba el enlace del legítimo, que se quedaba mudo sin enterarse. Con la
   * credencial por local esto ya casi no pasa, pero la regla se queda: dos Hubs
   * con la misma credencial es siempre una señal de que algo va mal.
   */
  conectar(enlace: EnlaceHub): boolean {
    if (this.enlaces.has(enlace.sucursal_id)) return false;
    this.enlaces.set(enlace.sucursal_id, enlace);
    return true;
  }

  /** Suelta el enlace, pero solo si es el mismo que se registró. */
  desconectar(sucursalId: string, enlace?: EnlaceHub): void {
    const vivo = this.enlaces.get(sucursalId);
    if (!vivo) return;
    if (enlace && vivo !== enlace) return;
    this.enlaces.delete(sucursalId);
  }

  enlaceDe(sucursalId: string): EnlaceHub | undefined {
    return this.enlaces.get(sucursalId);
  }

  get conectados(): number {
    return this.enlaces.size;
  }

  get total(): number {
    return this.porSucursal.size;
  }
}
