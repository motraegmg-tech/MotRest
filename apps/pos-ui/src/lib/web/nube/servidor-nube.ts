/**
 * El «Hub» de un restaurante que no tiene computadora (modalidad nube, 1.6.0).
 *
 * En la modalidad nube no hay Hub: los datos viven en Supabase. Pero el POS
 * entero está escrito contra el protocolo del Hub —`hola`, `push`, `pull`,
 * catálogos, credenciales— y reescribirlo sería rehacer la aplicación. Así que
 * este módulo HABLA COMO UN HUB, dentro del propio navegador, y por debajo lee y
 * escribe las tablas de la nube. `ClienteSync` no nota la diferencia.
 *
 * TODO LO QUE SE GUARDA VA CIFRADO con la llave de datos, que sale de la clave
 * remota y solo existe en los dispositivos del restaurante. En claro quedan el
 * número de orden, el id y el dispositivo: lo justo para no duplicar ni saltarse
 * nada. Supabase no puede leer ni una venta (ADR-29).
 *
 * LO QUE UN HUB HACE Y ESTO NO. Lo que necesita una máquina en el local o una
 * llave que no debe andar en un navegador: timbrar con FacturAPI, mandar
 * WhatsApp, imprimir por el spooler. A esas peticiones se contesta con un «no
 * disponible en modo nube» que la pantalla enseña, en vez de callar.
 *
 * LA VALIDACIÓN DE PERMISOS DEL HUB NO ES FRONTERA AQUÍ. En el Hub, un evento
 * con permisos falsos se rechaza en un equipo que el mesero no controla. Aquí
 * corre en el mismo navegador que lo generó; la frontera real es la contraseña
 * del restaurante (ADR-29).
 *
 * No sabe nada de Supabase: habla con un `AlmacenNube`. Así se prueba sin red.
 */
import type { EventoBase, Licencia } from "@motrest/dominio";
import {
  VERSION_PROTOCOLO,
  cifrar,
  descifrar,
  eventoValido,
  type Catalogo,
  type ClavesCanal,
  type EstadoFiscal,
  type MensajeCliente,
  type MensajeHub,
} from "@motrest/protocolo-sync";

/** Una fila del log en la nube, con el evento todavía cifrado. */
export interface FilaEventoNube {
  seq: number;
  id: string;
  device_id: string;
  sobre: string;
}

export interface FilaDocumentoNube {
  llave: string;
  sobre: string;
}

/** Lo que el «Hub» de la nube necesita de la base. Lo cumple Supabase y un doble. */
export interface AlmacenNube {
  seqActual(): Promise<number>;
  empujar(filas: { id: string; device_id: string; sobre: string }[]): Promise<{ id: string; seq: number }[]>;
  desde(seq: number, limite: number): Promise<FilaEventoNube[]>;
  documentos(prefijo: string): Promise<FilaDocumentoNube[]>;
  /** `version` en texto: puede pasar de 2^53. Devuelve si ganó. */
  publicarDocumento(llave: string, version: string, sobre: string): Promise<boolean>;
  /** La licencia firmada de este local, tal cual la dejó Central. */
  licencia(): Promise<unknown | null>;
  /**
   * El pulso para Central. SOLO campos seguros: un upsert de fila entera se cae
   * completo por un campo mal formado, y el local saldría «nunca reportó».
   */
  reportarPulso(pulso: PulsoNube): Promise<void>;
}

/** Lo que un restaurante en nube le cuenta a Central. La hora la pone la base. */
export interface PulsoNube {
  sucursal_id: string;
  version: string;
  plataforma: "web";
  eventos: number;
  ventas_dia?: number;
  cuentas_dia?: number;
}

export interface OpcionesServidorNube {
  almacen: AlmacenNube;
  sucursal_id: string;
  /** Las llaves del canal, del lado del Hub (`derivarClaves(clave, "hub")`). */
  canal: ClavesCanal;
  /** La llave con que se cifra lo guardado (`derivarLlaveDatosNube`). */
  datos: CryptoKey;
  verificarLicencia: (licencia: Licencia) => Promise<boolean>;
  /** La versión de MotRest de esta página, para el pulso. */
  version?: string;
  /** Manda al cliente un mensaje ya cifrado. */
  entregar: (crudo: string) => void;
  /** Algo que conviene enseñar en pantalla (sin datos del negocio). */
  avisar?: (texto: string) => void;
}

export const NO_EN_LA_NUBE = "No disponible en modo nube: tu restaurante no tiene computadora con MotRest instalado.";

/** Lo más que se pide en una página. Igual que el Hub. */
const PAGINA = 500;
/** Lo más que se empuja en un lote, por el tope de la función en la base. */
const LOTE = 200;

const SIN_FISCAL: EstadoFiscal = {
  csd_cargado: false,
  rfc: null,
  no_certificado: null,
  valido_hasta: null,
  dias_restantes: null,
  pac: null,
  cola: { pendientes: 0, timbradas: 0, rechazadas: 0 },
};

/** La llave de un documento, sin el nombre en claro (puede ser un id de persona). */
async function llaveDe(prefijo: "catalogo" | "credencial", nombre: string): Promise<string> {
  const huella = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nombre));
  const hex = Array.from(new Uint8Array(huella), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefijo}:${hex.slice(0, 40)}`;
}

/** Versión de un catálogo para «gana la mayor»: la del catálogo y, en empate, su fecha. */
export function versionDeCatalogo(c: { version: number; updated_at: number }): string {
  return (BigInt(Math.max(0, Math.trunc(c.version))) * 10_000_000_000_000n + BigInt(Math.max(0, Math.trunc(c.updated_at)))).toString();
}

/** Lo que las terminales ven de la licencia: sin credenciales ni enlace. */
function licenciaParaTerminales(l: Licencia): Licencia {
  const { soporte: _s, responsable: _r, nube: _n, ...publica } = l;
  return publica as Licencia;
}

export class ServidorNube {
  private device_id = "";
  private saludado = false;
  /** Hasta qué `seq` se le ha entregado a este cliente. */
  private entregadoHasta = 0;
  /** Todo se atiende en fila, como en el Hub: nada se intercala. */
  private turno: Promise<void> = Promise.resolve();
  private licenciaVerificada: { licencia: Licencia | null; verificada: boolean } | null = null;

  constructor(private o: OpcionesServidorNube) {}

  /** Un mensaje cifrado del cliente. */
  recibir(crudo: string): void {
    this.enFila(async () => {
      const mensaje = await descifrar<MensajeCliente>(this.o.canal.recepcion, crudo);
      if (mensaje) await this.atender(mensaje);
    });
  }

  /** Aviso de la base: hay eventos nuevos de otro dispositivo. */
  hayEventosNuevos(): void {
    this.enFila(() => this.entregarNuevos());
  }

  /** Aviso de la base: cambió un documento (catálogo o credencial). */
  cambioDocumento(fila: FilaDocumentoNube): void {
    this.enFila(async () => {
      if (!this.saludado) return;
      if (fila.llave.startsWith("catalogo:")) {
        const catalogo = await descifrar<Catalogo>(this.o.datos, fila.sobre);
        if (catalogo) await this.enviar({ tipo: "catalogo", catalogos: [catalogo] });
      } else if (fila.llave.startsWith("credencial:")) {
        await this.enviar({ tipo: "credenciales", credenciales: await this.credenciales() });
      }
    });
  }

  /** La licencia completa y verificada, para montar al responsable y al soporte. */
  async licencia(): Promise<{ licencia: Licencia | null; verificada: boolean }> {
    if (this.licenciaVerificada) return this.licenciaVerificada;
    const cruda = await this.o.almacen.licencia();
    const licencia = cruda && typeof cruda === "object" ? (cruda as Licencia) : null;
    const verificada = licencia ? await this.o.verificarLicencia(licencia) : false;
    this.licenciaVerificada = { licencia, verificada };
    return this.licenciaVerificada;
  }

  private enFila(tarea: () => Promise<void>): void {
    this.turno = this.turno.then(tarea).catch((causa) => {
      console.error("La nube no pudo atender una petición", causa);
      this.o.avisar?.("La nube no respondió. Lo que vendas queda guardado y se enviará solo.");
    });
  }

  private async enviar(mensaje: MensajeHub): Promise<void> {
    this.o.entregar(await cifrar(this.o.canal.envio, mensaje));
  }

  private async atender(m: MensajeCliente): Promise<void> {
    switch (m.tipo) {
      case "hola":
        return this.saludar(m);
      case "ping":
        return this.enviar({ tipo: "pong", ts: Date.now() });
    }
    if (!this.saludado) return;

    switch (m.tipo) {
      case "push":
        return this.ingerir(m.eventos);
      case "pull":
        return this.entregarDesde(m.desde_seq, m.limite ?? PAGINA);
      case "catalogo":
        return this.publicarCatalogos(m.catalogos);
      case "credenciales":
        if (m.accion === "publicar" && m.usuario_id && Array.isArray(m.credenciales)) {
          await this.o.almacen.publicarDocumento(
            await llaveDe("credencial", m.usuario_id),
            String(Date.now()),
            await cifrar(this.o.datos, { usuario_id: m.usuario_id, credenciales: m.credenciales }),
          );
          return;
        }
        return this.enviar({ tipo: "credenciales", credenciales: await this.credenciales() });
      case "admin":
        if (m.accion === "enlace_emparejamiento") return this.enviar({ tipo: "enlace", enlaces: [] });
        return this.enviar({ tipo: "terminales", terminales: [] });
      case "fiscal":
        return this.enviar({ tipo: "fiscal", estado: SIN_FISCAL, problema: NO_EN_LA_NUBE });
      case "secreto":
        return this.enviar({
          tipo: "secreto",
          ok: false,
          problema: NO_EN_LA_NUBE,
          estado: { facturapi: { configurada: false }, gmail: { configurada: false } },
        });
    }
  }

  private async saludar(m: Extract<MensajeCliente, { tipo: "hola" }>): Promise<void> {
    if (m.v !== VERSION_PROTOCOLO) {
      return this.enviar({
        tipo: "error",
        codigo: "version_incompatible",
        mensaje: "Esta página es de otra versión de MotRest. Recárgala.",
      });
    }
    if (m.sucursal_id !== this.o.sucursal_id) {
      return this.enviar({
        tipo: "error",
        codigo: "sucursal_distinta",
        mensaje: "Este dispositivo guardaba datos de otro restaurante. Sal y vuelve a entrar.",
      });
    }
    this.device_id = m.device_id;
    this.entregadoHasta = m.desde_seq;
    this.saludado = true;

    await this.enviar({
      tipo: "bienvenida",
      v: VERSION_PROTOCOLO,
      hub_id: "nube",
      seq_actual: await this.o.almacen.seqActual(),
      ts: Date.now(),
    });

    const catalogos = await this.catalogos();
    const { licencia, verificada } = await this.licencia();
    catalogos.push({
      clave: "licencia_estado",
      version: licencia?.emitida_ts ?? 0,
      updated_at: licencia?.emitida_ts ?? 0,
      datos: { licencia: licencia ? licenciaParaTerminales(licencia) : null, verificada },
    });
    await this.enviar({ tipo: "catalogo", catalogos });
    await this.pulso();
  }

  /**
   * El pulso a Central: al entrar, y al cerrar la caja con las cifras del corte
   * —lo mismo que reporta un Hub con su último `caja_cerrada`—. Nunca tumba
   * nada: es información para MOTRAE, no para el restaurante.
   */
  private async pulso(corte?: { ventas: number; cuentas: number }): Promise<void> {
    try {
      await this.o.almacen.reportarPulso({
        sucursal_id: this.o.sucursal_id,
        version: this.o.version ?? "web",
        plataforma: "web",
        eventos: await this.o.almacen.seqActual(),
        ...(corte ? { ventas_dia: corte.ventas, cuentas_dia: corte.cuentas } : {}),
      });
    } catch (causa) {
      console.warn("No se pudo reportar el pulso del restaurante", causa);
    }
  }

  private async ingerir(eventos: readonly unknown[]): Promise<void> {
    const validos = eventos.filter(
      (e): e is EventoBase => eventoValido(e) && e.sucursal_id === this.o.sucursal_id,
    );
    const acks: { id: string; seq: number }[] = [];
    for (let i = 0; i < validos.length; i += LOTE) {
      const lote = validos.slice(i, i + LOTE);
      const filas = await Promise.all(
        lote.map(async (e) => {
          const { seq: _seq, ...sinSeq } = e as EventoBase & { seq?: number };
          return { id: e.id, device_id: e.device_id, sobre: await cifrar(this.o.datos, sinSeq) };
        }),
      );
      acks.push(...(await this.o.almacen.empujar(filas)));
    }
    if (acks.length > 0) await this.enviar({ tipo: "acks", acks });

    const cierre = [...validos].reverse().find((e) => e.tipo === "caja_cerrada") as
      | (EventoBase & { resumen?: { total_vendido?: number; cuentas_cerradas?: number } })
      | undefined;
    if (cierre) {
      await this.pulso({
        ventas: Math.trunc(cierre.resumen?.total_vendido ?? 0),
        cuentas: Math.trunc(cierre.resumen?.cuentas_cerradas ?? 0),
      });
    }
  }

  private async entregarDesde(desde: number, limite: number): Promise<void> {
    const tope = Math.min(Math.max(limite, 1), 1000);
    const filas = await this.o.almacen.desde(desde, tope);
    const eventos = await this.abrir(filas);
    if (filas.length > 0) this.entregadoHasta = Math.max(this.entregadoHasta, filas[filas.length - 1]!.seq);
    await this.enviar({ tipo: "eventos", eventos, hay_mas: filas.length === tope });
  }

  /** Lo nuevo de OTROS dispositivos, como la difusión del Hub. */
  private async entregarNuevos(): Promise<void> {
    if (!this.saludado) return;
    for (;;) {
      const filas = await this.o.almacen.desde(this.entregadoHasta, PAGINA);
      if (filas.length === 0) return;
      this.entregadoHasta = filas[filas.length - 1]!.seq;
      const ajenos = await this.abrir(filas.filter((f) => f.device_id !== this.device_id));
      if (ajenos.length > 0) await this.enviar({ tipo: "eventos", eventos: ajenos, hay_mas: false });
      if (filas.length < PAGINA) return;
    }
  }

  private async abrir(filas: readonly FilaEventoNube[]): Promise<EventoBase[]> {
    const eventos: EventoBase[] = [];
    for (const f of filas) {
      const e = await descifrar<EventoBase>(this.o.datos, f.sobre);
      /*
       * Uno que no abre se salta y se dice. No debería pasar nunca —solo los
       * dispositivos del restaurante tienen la llave—, pero si pasa, detenerse
       * dejaría a todos los demás sin sincronizar por uno solo.
       */
      if (!e || e.id !== f.id) {
        console.warn(`Evento ${f.id} ilegible en la nube; se omite`);
        continue;
      }
      eventos.push({ ...e, seq: f.seq } as EventoBase);
    }
    return eventos;
  }

  private async publicarCatalogos(catalogos: readonly Catalogo[]): Promise<void> {
    for (const c of catalogos) {
      if (!c || typeof c.clave !== "string" || c.clave === "licencia_estado") continue;
      await this.o.almacen.publicarDocumento(
        await llaveDe("catalogo", c.clave),
        versionDeCatalogo(c),
        await cifrar(this.o.datos, c),
      );
    }
    /*
     * Como el Hub: se devuelve lo vigente. Si el de este dispositivo iba atrás,
     * así se entera del bueno; si iba adelante, recibe el suyo y no cambia nada.
     */
    const vigentes = await this.catalogos();
    if (vigentes.length > 0) await this.enviar({ tipo: "catalogo", catalogos: vigentes });
  }

  private async catalogos(): Promise<Catalogo[]> {
    const filas = await this.o.almacen.documentos("catalogo:");
    const catalogos: Catalogo[] = [];
    for (const f of filas) {
      const c = await descifrar<Catalogo>(this.o.datos, f.sobre);
      if (c && typeof c.clave === "string") catalogos.push(c);
    }
    return catalogos;
  }

  private async credenciales(): Promise<Record<string, unknown[]>> {
    const filas = await this.o.almacen.documentos("credencial:");
    const mapa: Record<string, unknown[]> = {};
    for (const f of filas) {
      const d = await descifrar<{ usuario_id: string; credenciales: unknown[] }>(this.o.datos, f.sobre);
      if (d && typeof d.usuario_id === "string" && Array.isArray(d.credenciales)) {
        mapa[d.usuario_id] = d.credenciales;
      }
    }
    return mapa;
  }
}
