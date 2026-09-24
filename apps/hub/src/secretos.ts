/**
 * Los secretos del restaurante, del lado del Hub: dónde viven y quién gana.
 *
 * Hoy son dos —la llave de FacturAPI de su organización y la contraseña de
 * aplicación de su Gmail— y los dos pueden llegar por dos caminos:
 *
 *   - **De Central**, cerrados en un sobre (`comun/sobre.ts`) que solo este Hub
 *     puede abrir, por el buzón `secretos_pendientes` de la nube. La nube es un
 *     cartero: aunque alguien leyera su base entera, no vería ninguna llave.
 *   - **De la caja**, por el canal cifrado del local, tecleados por el
 *     responsable del restaurante o por el soporte de MOTRAE.
 *
 * Y la regla entre los dos es la de Gonzalo: **gana el más reciente**, por
 * `emitido_ts`. Lo que se configura en un lado aparece en el otro (el estado,
 * nunca el valor, va en el pulso).
 *
 * EL PAR DEL HUB
 *
 * Se genera UNA vez y se guarda junto a la base, como la identidad del local
 * (`sucursal.txt`, modo 0o600). La pública viaja en el pulso para que Central
 * cierre sus sobres; la privada no sale nunca de esta máquina. Si el archivo se
 * pierde o se corrompe se genera otro: los sobres que estuvieran en camino ya
 * no se podrán abrir —se dice en claro, y Central los reenvía con la pública
 * nueva en cuanto llega el siguiente pulso—.
 *
 * QUÉ NO SE ESCRIBE NUNCA: ni la llave ni la contraseña, en la bitácora, en el
 * pulso ni en un mensaje de error. Tampoco su terminación: basta con decir qué
 * cambió y desde dónde.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  abrirSobre,
  esPublicaDeSobre,
  esSecreto,
  esSecretoAccesoWeb,
  generarParDeSobre,
  llaveFacturapiValida,
  normalizarContrasenaGmail,
  terminacion,
  type ClaseSecreto,
  type EstadoSecretos,
  type ModoFacturapi,
  type OrigenSecreto,
  type ParDeSobre,
  type Secreto,
  type SecretoAccesoWeb,
} from "@motrest/dominio";
import type { DatosOrganizacion, PruebaDeLlave } from "./fiscal/facturapi.js";

/** Lo que el Hub guarda de FacturAPI. Una entrada en su tabla de estado. */
export interface FacturapiGuardada {
  /** Ausente = no hay llave: nunca la hubo, o se quitó (ver `emitido_ts`). */
  llave?: string;
  modo?: ModoFacturapi;
  organizacion_id?: string;
  organizacion_nombre?: string;
  /**
   * Cuándo se decidió. Se conserva también al QUITAR la llave: es la lápida
   * que impide que un sobre viejo que llega tarde la resucite.
   */
  emitido_ts: number;
  origen: OrigenSecreto;
  /**
   * Desde cuándo hay llave de cada modo. De aquí arranca la factura global:
   * solo se emiten las de los meses que cerraron después.
   */
  desde?: Partial<Record<ModoFacturapi, number>>;
  organizacion?: Omit<DatosOrganizacion, "id">;
  verificada_ts?: number;
  /** Llegó de Central sin internet para comprobarla: se comprueba después. */
  por_verificar?: boolean;
  error?: string;
}

/** La contraseña de Gmail y de cuándo es. Vive en `correo_config`. */
export interface GmailGuardada {
  contrasena?: string;
  emitido_ts: number;
  origen: OrigenSecreto;
  remitente?: string;
  error?: string;
}

/** Dónde se guardan. En el Hub real, su tabla de estado; en las pruebas, memoria. */
export interface AlmacenDeSecretos {
  leerFacturapi(): Promise<FacturapiGuardada | null>;
  guardarFacturapi(dato: FacturapiGuardada): Promise<void>;
  leerGmail(): Promise<GmailGuardada | null>;
  guardarGmail(dato: GmailGuardada): Promise<void>;
}

export interface OpcionesSecretos {
  almacen: AlmacenDeSecretos;
  /** Archivo del par X25519, junto a la base. */
  rutaPar: string;
  /** La sucursal de ESTE Hub. Un secreto de otra se rechaza. */
  sucursal: () => string;
  probarFacturapi: (llave: string) => Promise<PruebaDeLlave>;
  /** Se avisa tras aplicar un cambio: para barrer la cola, reportar el pulso… */
  alCambiar?: (clase: ClaseSecreto) => void;
  /**
   * La clave remota del túnel de la web (1.6.0). Llega en el mismo buzón pero
   * no es un secreto de FacturAPI ni de Gmail: se entrega tal cual a quien la
   * guarda y abre el túnel. Sin esto, el sobre se rechaza con un motivo claro.
   */
  alRecibirAccesoWeb?: (dato: SecretoAccesoWeb) => Promise<ResultadoSecreto>;
  registrar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
  ahora?: () => number;
}

export interface ResultadoSecreto {
  ok: boolean;
  /** Si cambió lo vigente. `ok` sin `aplicado` = había uno más reciente. */
  aplicado: boolean;
  problema?: string;
}

/** Cada cuánto se vuelve a preguntar a FacturAPI por la organización. */
const REFRESCAR_ORGANIZACION_MS = 24 * 3_600_000;

const FORMATO_PAR = "motrest-par-sobre-v1";

function fecha(ts: number): string {
  return new Date(ts).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

function desde(origen: OrigenSecreto): string {
  return origen === "central" ? "Central" : "la caja";
}

export class SecretosDelHub {
  private par: ParDeSobre | null = null;
  private facturapi: FacturapiGuardada | null = null;
  private gmail: GmailGuardada | null = null;
  /** Una operación a la vez: la caja y la nube pueden llegar en el mismo segundo. */
  private turno: Promise<unknown> = Promise.resolve();

  constructor(private readonly opciones: OpcionesSecretos) {}

  private ahora(): number {
    return this.opciones.ahora?.() ?? Date.now();
  }

  private anotar(nivel: "info" | "aviso" | "error", mensaje: string): void {
    this.opciones.registrar?.(nivel, mensaje);
  }

  /**
   * Avisa del cambio SIN que el aviso pueda deshacer lo que ya se guardó.
   *
   * `alCambiar` (en `main.ts`) reengancha FacturAPI en la cola y sella lo que
   * esperaba una llave: efectos secundarios reales, con su propio SQL y sus
   * propias llamadas. Si algo ahí truena DESPUÉS de que la llave ya quedó
   * guardada y aplicada, no puede convertir un envío que sí funcionó en uno
   * que Central reporta como fallido.
   *
   * Es justo lo que pasó al crear la llave de producción de Tortas Fc
   * (21-sep-2026): el sobre se abrió bien, la llave quedó puesta —se vio en el
   * estado que reportó el Hub—, y un efecto secundario sin proteger
   * (`encolarParaFacturapi`, ver `facturador.ts`) tronó después y lo disfrazó
   * de «El Hub falló al abrir el sobre», un mensaje que ni siquiera describía
   * lo que había pasado.
   */
  private avisarCambio(clase: ClaseSecreto): void {
    try {
      this.opciones.alCambiar?.(clase);
    } catch (causa) {
      this.anotar(
        "error",
        `La llave de ${clase} quedó puesta, pero avisar del cambio falló: ` +
          (causa instanceof Error ? causa.message : String(causa)),
      );
    }
  }

  private enTurno<T>(trabajo: () => Promise<T>): Promise<T> {
    const siguiente = this.turno.then(trabajo, trabajo);
    this.turno = siguiente.catch(() => undefined);
    return siguiente;
  }

  /** Carga el par (o lo crea) y lo que ya estaba guardado. Se llama al arrancar. */
  async cargar(): Promise<void> {
    this.par = await this.cargarOCrearPar();
    this.facturapi = await this.opciones.almacen.leerFacturapi();
    this.gmail = await this.opciones.almacen.leerGmail();
  }

  private async cargarOCrearPar(): Promise<ParDeSobre> {
    const ruta = this.opciones.rutaPar;
    if (existsSync(ruta)) {
      try {
        const guardado = JSON.parse(readFileSync(ruta, "utf8")) as Partial<ParDeSobre> & { formato?: string };
        if (esPublicaDeSobre(guardado.publica) && typeof guardado.privada === "string" && guardado.privada) {
          return { publica: guardado.publica, privada: guardado.privada };
        }
      } catch {
        // Ilegible: se cae al caso de abajo y se dice.
      }
      this.anotar(
        "aviso",
        "El par de llaves del Hub estaba dañado: se generó otro. Lo que Central haya mandado antes habrá que reenviarlo.",
      );
    }

    const par = await generarParDeSobre();
    try {
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(
        ruta,
        JSON.stringify({ formato: FORMATO_PAR, ...par, creado_ts: this.ahora() }),
        { encoding: "utf8", mode: 0o600 },
      );
      this.anotar("info", "Par de llaves del Hub generado: Central ya puede mandarle secretos cifrados.");
    } catch (causa) {
      // Sin poder escribirlo se usa en memoria: se pierde al reiniciar y Central
      // tendría que reenviar, pero el restaurante abre hoy.
      this.anotar("aviso", `No se pudo guardar el par de llaves del Hub: ${String(causa)}`);
    }
    return par;
  }

  /** Lo que se publica en el pulso. Vacío hasta que `cargar()` termina. */
  /**
   * Abre un sobre dirigido a este Hub que NO es un secreto: los datos fiscales
   * que un comensal dejó en el portal de autofactura (1.5.6). Mismo par, misma
   * regla: la privada no sale de aquí, y lo que no se puede abrir es `null`.
   */
  async abrir(sobre: unknown): Promise<string | null> {
    if (!this.par) return null;
    return abrirSobre(sobre, this.par);
  }

  llavePublica(): string {
    return this.par?.publica ?? "";
  }

  /** La llave vigente de FacturAPI, para armar el PAC. Solo dentro del Hub. */
  facturapiVigente(): {
    llave: string;
    modo: ModoFacturapi;
    desde_ts: number;
    organizacion?: FacturapiGuardada["organizacion"];
  } | null {
    const f = this.facturapi;
    if (!f?.llave || !f.modo) return null;
    return {
      llave: f.llave,
      modo: f.modo,
      desde_ts: f.desde?.[f.modo] ?? f.emitido_ts,
      organizacion: f.organizacion,
    };
  }

  /** Lo que se puede enseñar: ni un carácter del secreto más allá de su terminación. */
  estado(): EstadoSecretos {
    const f = this.facturapi;
    const g = this.gmail;
    return {
      facturapi: f?.llave
        ? {
            configurada: true,
            modo: f.modo,
            termina_en: terminacion(f.llave),
            origen: f.origen,
            actualizado_ts: f.emitido_ts,
            organizacion_id: f.organizacion_id,
            razon_social: f.organizacion?.razon_social ?? f.organizacion_nombre,
            rfc: f.organizacion?.rfc,
            csd_vence: f.organizacion?.csd_vence,
            lista: f.organizacion?.lista,
            pendientes: f.organizacion?.pendientes,
            error:
              f.error ??
              (f.por_verificar
                ? "Llegó sin internet para comprobarla con FacturAPI: se comprobará en cuanto haya red."
                : undefined),
          }
        : { configurada: false, ...(f ? { origen: f.origen, actualizado_ts: f.emitido_ts } : {}) },
      gmail: g?.contrasena
        ? {
            configurada: true,
            termina_en: terminacion(g.contrasena),
            origen: g.origen,
            actualizado_ts: g.emitido_ts,
            remitente: g.remitente,
            error: g.error,
          }
        : { configurada: false, ...(g ? { origen: g.origen, actualizado_ts: g.emitido_ts } : {}) },
    };
  }

  private vigenteDe(clase: ClaseSecreto): { emitido_ts: number; origen: OrigenSecreto } | null {
    return clase === "facturapi" ? this.facturapi : this.gmail;
  }

  /**
   * Aplica un secreto si es el más reciente.
   *
   * `estricta` es la caja: la persona está delante, así que una llave de
   * FacturAPI que no se pudo comprobar (sin internet) se rechaza para que lo
   * sepa ahora. Desde Central se acepta —la generó FacturAPI misma— y se deja
   * marcada para comprobarla en cuanto haya red.
   */
  aplicar(secreto: Secreto, estricta: boolean): Promise<ResultadoSecreto> {
    return this.enTurno(() => this.aplicarYa(secreto, estricta));
  }

  private async aplicarYa(secreto: Secreto, estricta: boolean): Promise<ResultadoSecreto> {
    if (secreto.sucursal_id !== this.opciones.sucursal()) {
      return {
        ok: false,
        aplicado: false,
        problema: `Esta llave es para otro restaurante (${secreto.sucursal_id}); este Hub es ${this.opciones.sucursal()}.`,
      };
    }

    const vigente = this.vigenteDe(secreto.clase);
    if (vigente && secreto.emitido_ts <= vigente.emitido_ts) {
      return {
        ok: true,
        aplicado: false,
        problema:
          `Se conservó la del ${fecha(vigente.emitido_ts)} (${desde(vigente.origen)}), ` +
          "que es más reciente que esta.",
      };
    }

    if (secreto.clase === "gmail") {
      const contrasena = normalizarContrasenaGmail(secreto.contrasena);
      if (!contrasena) {
        return { ok: false, aplicado: false, problema: "La contraseña de aplicación de Google son 16 letras." };
      }
      const nueva: GmailGuardada = {
        contrasena,
        emitido_ts: secreto.emitido_ts,
        origen: secreto.origen,
        remitente: secreto.remitente?.trim() || this.gmail?.remitente,
      };
      await this.opciones.almacen.guardarGmail(nueva);
      this.gmail = nueva;
      this.anotar("info", `Contraseña de Gmail actualizada desde ${desde(secreto.origen)}.`);
      this.avisarCambio("gmail");
      return { ok: true, aplicado: true };
    }

    const llave = secreto.llave.trim();
    const prueba = await this.opciones.probarFacturapi(llave);
    if (prueba.estado === "invalida") return { ok: false, aplicado: false, problema: prueba.mensaje };
    if (prueba.estado === "sin_red" && estricta) {
      return {
        ok: false,
        aplicado: false,
        problema: `No se pudo comprobar la llave con FacturAPI (${prueba.mensaje}). Inténtalo cuando haya internet.`,
      };
    }
    if (
      prueba.estado === "valida" &&
      secreto.organizacion_id &&
      prueba.organizacion.id !== secreto.organizacion_id
    ) {
      return {
        ok: false,
        aplicado: false,
        problema: "La llave es de otra organización de FacturAPI que la que se eligió en Central.",
      };
    }

    const ahora = this.ahora();
    const previa = this.facturapi;
    let comprobada: Pick<FacturapiGuardada, "organizacion" | "verificada_ts" | "por_verificar">;
    let organizacionId = secreto.organizacion_id;
    if (prueba.estado === "valida") {
      const { id, ...organizacion } = prueba.organizacion;
      organizacionId = id;
      comprobada = { organizacion, verificada_ts: ahora };
    } else {
      comprobada = { por_verificar: true };
    }

    const nueva: FacturapiGuardada = {
      llave,
      modo: secreto.modo,
      organizacion_id: organizacionId,
      organizacion_nombre: secreto.organizacion_nombre ?? comprobada.organizacion?.razon_social,
      emitido_ts: secreto.emitido_ts,
      origen: secreto.origen,
      desde: { ...previa?.desde, [secreto.modo]: previa?.desde?.[secreto.modo] ?? ahora },
      ...comprobada,
    };

    await this.opciones.almacen.guardarFacturapi(nueva);
    this.facturapi = nueva;
    this.anotar(
      "info",
      `Llave de FacturAPI (${secreto.modo === "produccion" ? "producción" : "pruebas"}) actualizada desde ${desde(secreto.origen)}` +
        (nueva.por_verificar ? ", pendiente de comprobar por falta de internet." : "."),
    );
    this.avisarCambio("facturapi");
    return { ok: true, aplicado: true };
  }

  /** Desde la caja: la llave va directo al Hub y no se queda en la tableta. */
  guardarDesdeCaja(entrada: {
    clase?: ClaseSecreto;
    valor?: string;
    modo?: ModoFacturapi;
    remitente?: string;
  }): Promise<ResultadoSecreto> {
    const valor = entrada.valor?.trim() ?? "";
    if (!valor) return Promise.resolve({ ok: false, aplicado: false, problema: "Falta la llave." });

    /*
     * La última palabra la tiene quien la está tecleando AHORA. Si el reloj de
     * este equipo va atrás del de Central, un «ahora» de aquí podría perder
     * contra lo que Central mandó hace un minuto; por eso nunca queda por
     * debajo de lo vigente.
     */
    const marca = (clase: ClaseSecreto) =>
      Math.max(this.ahora(), (this.vigenteDe(clase)?.emitido_ts ?? 0) + 1);

    if (entrada.clase === "gmail") {
      const contrasena = normalizarContrasenaGmail(valor);
      if (!contrasena) {
        return Promise.resolve({
          ok: false,
          aplicado: false,
          problema: "La contraseña de aplicación de Google son 16 letras (se aceptan con o sin espacios).",
        });
      }
      return this.aplicar(
        {
          clase: "gmail",
          contrasena,
          ...(entrada.remitente?.trim() ? { remitente: entrada.remitente.trim() } : {}),
          sucursal_id: this.opciones.sucursal(),
          emitido_ts: marca("gmail"),
          origen: "local",
        },
        true,
      );
    }

    if (entrada.clase !== "facturapi") {
      return Promise.resolve({ ok: false, aplicado: false, problema: "¿Qué llave es? Falta la clase." });
    }
    const modo: ModoFacturapi =
      entrada.modo ?? (valor.startsWith("sk_live_") ? "produccion" : "pruebas");
    if (!llaveFacturapiValida(valor, modo)) {
      return Promise.resolve({
        ok: false,
        aplicado: false,
        problema:
          modo === "produccion"
            ? "La llave de producción empieza con sk_live_. Cópiala completa desde el panel de FacturAPI."
            : "La llave de pruebas empieza con sk_test_. Cópiala completa desde el panel de FacturAPI.",
      });
    }
    return this.aplicar(
      {
        clase: "facturapi",
        llave: valor,
        modo,
        sucursal_id: this.opciones.sucursal(),
        emitido_ts: marca("facturapi"),
        origen: "local",
      },
      true,
    );
  }

  /** Quita un secreto. Deja la lápida con su fecha para que nada viejo lo resucite. */
  quitarDesdeCaja(clase: ClaseSecreto | undefined): Promise<ResultadoSecreto> {
    return this.enTurno(async () => {
      if (clase !== "facturapi" && clase !== "gmail") {
        return { ok: false, aplicado: false, problema: "¿Qué llave es? Falta la clase." };
      }
      const emitido_ts = Math.max(this.ahora(), (this.vigenteDe(clase)?.emitido_ts ?? 0) + 1);
      if (clase === "facturapi") {
        const lapida: FacturapiGuardada = { emitido_ts, origen: "local", desde: this.facturapi?.desde };
        await this.opciones.almacen.guardarFacturapi(lapida);
        this.facturapi = lapida;
        this.anotar("aviso", "Se quitó la llave de FacturAPI desde la caja: no se timbrará hasta poner otra.");
      } else {
        const lapida: GmailGuardada = { emitido_ts, origen: "local", remitente: this.gmail?.remitente };
        await this.opciones.almacen.guardarGmail(lapida);
        this.gmail = lapida;
        this.anotar("aviso", "Se quitó la contraseña de Gmail desde la caja: no saldrán correos hasta poner otra.");
      }
      this.avisarCambio(clase);
      return { ok: true, aplicado: true };
    });
  }

  /**
   * Un sobre que dejó Central en la nube.
   *
   * Devuelve el error en palabras de persona: va a la fila del buzón y Central
   * lo enseña. Nunca incluye el contenido del sobre.
   */
  async recibirDeLaNube(fila: { clase?: unknown; sobre: unknown }): Promise<ResultadoSecreto> {
    if (!this.par) {
      return { ok: false, aplicado: false, problema: "El Hub todavía no tiene su par de llaves; se reintentará." };
    }
    const claro = await abrirSobre(fila.sobre, this.par);
    if (claro === null) {
      return {
        ok: false,
        aplicado: false,
        problema:
          "El sobre no se pudo abrir con la llave de este Hub: se cerró para otro equipo o con una llave pública " +
          "vieja. Reenvíalo desde Central después del siguiente pulso.",
      };
    }
    let dato: unknown;
    try {
      dato = JSON.parse(claro);
    } catch {
      return { ok: false, aplicado: false, problema: "El contenido del sobre no es válido." };
    }
    /*
     * El acceso web (1.6.0) va aparte: no se valida como una llave de
     * facturación ni se enseña en ningún semáforo. Se comprueba que sea de
     * ESTE local, igual que todo lo demás, y se entrega.
     */
    if (esSecretoAccesoWeb(dato)) {
      if (dato.sucursal_id !== this.opciones.sucursal()) {
        return { ok: false, aplicado: false, problema: "El acceso web que llegó es de otro restaurante." };
      }
      if (!this.opciones.alRecibirAccesoWeb) {
        return { ok: false, aplicado: false, problema: "Este Hub no sabe abrir el túnel de la web." };
      }
      return this.opciones.alRecibirAccesoWeb(dato);
    }
    if (!esSecreto(dato)) {
      return {
        ok: false,
        aplicado: false,
        problema: "El sobre no trae una llave válida (revisa el modo de FacturAPI o las 16 letras de Gmail).",
      };
    }
    if (typeof fila.clase === "string" && fila.clase !== dato.clase) {
      return { ok: false, aplicado: false, problema: `El buzón dice «${fila.clase}» y el sobre trae «${dato.clase}».` };
    }
    return this.aplicar(dato, false);
  }

  /**
   * Comprueba lo que quedó pendiente y refresca la organización una vez al día.
   *
   * Es lo que alimenta el semáforo de Central —¿CSD vigente?, ¿cuándo vence?,
   * ¿qué falta?— sin que nadie tenga que pedirlo. Se llama cada hora.
   */
  verificar(): Promise<void> {
    return this.enTurno(async () => {
      const f = this.facturapi;
      if (!f?.llave) return;
      const ahora = this.ahora();
      if (!f.por_verificar && f.verificada_ts && ahora - f.verificada_ts < REFRESCAR_ORGANIZACION_MS) return;

      const prueba = await this.opciones.probarFacturapi(f.llave);
      if (prueba.estado === "sin_red") return;

      const actualizada: FacturapiGuardada =
        prueba.estado === "valida"
          ? (() => {
              const { id, ...org } = prueba.organizacion;
              return {
                ...f,
                organizacion_id: f.organizacion_id ?? id,
                organizacion: org,
                verificada_ts: ahora,
                por_verificar: false,
                error: undefined,
              };
            })()
          : { ...f, por_verificar: false, verificada_ts: ahora, error: prueba.mensaje };

      await this.opciones.almacen.guardarFacturapi(actualizada);
      this.facturapi = actualizada;
      if (prueba.estado === "invalida") {
        this.anotar("error", `FacturAPI ya no reconoce la llave del restaurante: ${prueba.mensaje}`);
      }
      this.avisarCambio("facturapi");
    });
  }
}
