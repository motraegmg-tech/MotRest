/**
 * El túnel de la web al Hub (1.6.0, modalidad «ambas»).
 *
 * QUÉ PROBLEMA RESUELVE. El Hub vive en la red del restaurante y nunca abre un
 * puerto a internet (ADR-23). Un navegador en otra ciudad no puede llegar a él.
 * Los dos, en cambio, sí pueden hablar con Supabase Realtime: el Hub ya tiene un
 * socket abierto ahí todo el día. Este módulo convierte un canal *broadcast* de
 * Realtime en algo que se comporta como el WebSocket de la LAN, para que el
 * protocolo de sincronización pase por él sin enterarse.
 *
 * LO QUE VIAJA ESTÁ CIFRADO ANTES DE LLEGAR AQUÍ. Cada mensaje es ya un sobre
 * AES-GCM de `cifrado.ts`; este módulo solo lo trocea y lo vuelve a juntar.
 * Supabase ve fragmentos de texto cifrado y nada más.
 *
 * TRES COSAS QUE EL WEBSOCKET DABA GRATIS Y AQUÍ HAY QUE HACER A MANO:
 *
 * 1. **Tamaño.** Realtime limita cada mensaje; una página de `pull` con mil
 *    eventos pasa de un megabyte. Se trocea en fragmentos de ~60 KB.
 * 2. **Orden.** El protocolo depende del orden (el saludo va primero). Cada
 *    mensaje lleva un número por sesión y sentido, y se entregan en orden.
 * 3. **Saber si el otro sigue ahí.** Broadcast no tiene «conexión cerrada». Hay
 *    un saludo de apertura con respuesta y latidos en los dos sentidos; sin
 *    latido, la sesión se da por muerta.
 *
 * UN FRAGMENTO PERDIDO CIERRA LA SESIÓN, y es a propósito. Broadcast entrega a
 * lo sumo una vez. En vez de reinventar TCP con reenvíos, un hueco que no se
 * llena en unos segundos cierra la sesión: el cliente reconecta y el protocolo
 * de sincronización, que ya es idempotente (el Hub descarta eventos repetidos
 * por id y el cliente pide desde su último `seq`), se pone al día solo.
 */

/** Quién manda el sobre: `c` = navegador → Hub, `h` = Hub → navegador. */
export type SentidoTunel = "c" | "h";

/** Un trozo de un mensaje del protocolo, ya cifrado. */
export interface FragmentoTunel {
  /** Id de la sesión web: lo inventa el navegador al abrir. */
  s: string;
  d: SentidoTunel;
  /** Número del mensaje dentro de esta sesión y sentido. Empieza en 0. */
  m: number;
  /** Índice del fragmento y total de fragmentos del mensaje. */
  i: number;
  t: number;
  /** El trozo de texto. */
  x: string;
}

/**
 * Control de la sesión.
 * - `abrir`: el navegador pide sesión. El Hub contesta `abierta`.
 * - `latido`: sigo aquí. Los dos lados lo mandan.
 * - `cerrar`: se acabó; el que lo recibe deja de esperar.
 */
export interface ControlTunel {
  s: string;
  d: SentidoTunel;
  k: "abrir" | "abierta" | "latido" | "cerrar";
  /** Por qué se cierra, en palabras de persona. Solo en `cerrar`. */
  motivo?: string;
}

export type SobreTunel = FragmentoTunel | ControlTunel;

/** El nombre del evento broadcast dentro del canal. */
export const EVENTO_TUNEL = "t";

/** El canal de un restaurante. El `:` es lo que usan las políticas de Realtime. */
export function canalTunelDe(sucursalId: string): string {
  return `tunel:${sucursalId}`;
}

/** Tamaño máximo de cada trozo, en caracteres (el sobre cifrado es ASCII). */
export const TAMANO_FRAGMENTO = 60_000;

/** Cada cuánto late un extremo. */
export const LATIDO_MS = 15_000;

/** Sin nada del otro lado en este tiempo, la sesión está muerta. */
export const SILENCIO_MAXIMO_MS = 45_000;

/** Cuánto se espera a que un hueco en el orden se llene antes de cerrar. */
export const ESPERA_HUECO_MS = 10_000;

/**
 * Lo máximo que se guarda a medio juntar por sesión. Un extremo que manda
 * fragmentos sin terminar nunca un mensaje no puede llenar la memoria del Hub.
 */
export const MAXIMO_PENDIENTE = 32 * 1024 * 1024;

const ID_SESION = /^[A-Za-z0-9_-]{8,64}$/;

export function esSobreTunel(valor: unknown): valor is SobreTunel {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Record<string, unknown>;
  if (typeof v.s !== "string" || !ID_SESION.test(v.s)) return false;
  if (v.d !== "c" && v.d !== "h") return false;
  if (typeof v.k === "string") {
    return (
      (v.k === "abrir" || v.k === "abierta" || v.k === "latido" || v.k === "cerrar") &&
      (v.motivo === undefined || typeof v.motivo === "string")
    );
  }
  return (
    Number.isInteger(v.m) && (v.m as number) >= 0 &&
    Number.isInteger(v.t) && (v.t as number) >= 1 && (v.t as number) <= 10_000 &&
    Number.isInteger(v.i) && (v.i as number) >= 0 && (v.i as number) < (v.t as number) &&
    typeof v.x === "string" && v.x.length <= TAMANO_FRAGMENTO
  );
}

export function esControl(sobre: SobreTunel): sobre is ControlTunel {
  return "k" in sobre;
}

/** Trocea un mensaje. Un mensaje vacío sigue siendo un fragmento. */
export function fragmentar(
  sesion: string,
  sentido: SentidoTunel,
  numero: number,
  texto: string,
  tamano = TAMANO_FRAGMENTO,
): FragmentoTunel[] {
  const total = Math.max(1, Math.ceil(texto.length / tamano));
  const trozos: FragmentoTunel[] = [];
  for (let i = 0; i < total; i++) {
    trozos.push({ s: sesion, d: sentido, m: numero, i, t: total, x: texto.slice(i * tamano, (i + 1) * tamano) });
  }
  return trozos;
}

/** Un id de sesión nuevo, imposible de adivinar. */
export function nuevaSesionTunel(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Junta los fragmentos de UN sentido de UNA sesión y entrega los mensajes en
 * orden. Devuelve lo que se puede entregar ya; si detecta un abuso o un hueco
 * que no se llena, lo dice con `roto` y la sesión se cierra.
 */
export class Reensamblador {
  private siguiente = 0;
  private aMedias = new Map<number, { total: number; trozos: (string | undefined)[]; llegados: number }>();
  private completos = new Map<number, string>();
  private pendiente = 0;
  private huecoDesde: number | null = null;
  roto: string | null = null;

  constructor(private ahora: () => number = Date.now) {}

  agregar(f: FragmentoTunel): string[] {
    if (this.roto) return [];
    if (f.m < this.siguiente || this.completos.has(f.m)) return []; // repetido: ya se entregó

    let parcial = this.aMedias.get(f.m);
    if (!parcial) {
      parcial = { total: f.t, trozos: new Array(f.t), llegados: 0 };
      this.aMedias.set(f.m, parcial);
    }
    if (parcial.total !== f.t) {
      this.roto = "Un mensaje llegó con dos tamaños distintos";
      return [];
    }
    if (parcial.trozos[f.i] === undefined) {
      parcial.trozos[f.i] = f.x;
      parcial.llegados += 1;
      this.pendiente += f.x.length;
    }
    if (this.pendiente > MAXIMO_PENDIENTE) {
      this.roto = "Demasiado texto a medio juntar";
      return [];
    }

    if (parcial.llegados === parcial.total) {
      this.aMedias.delete(f.m);
      this.completos.set(f.m, parcial.trozos.join(""));
    }
    return this.entregar();
  }

  private entregar(): string[] {
    const listos: string[] = [];
    while (this.completos.has(this.siguiente)) {
      const texto = this.completos.get(this.siguiente)!;
      this.completos.delete(this.siguiente);
      this.pendiente -= texto.length;
      listos.push(texto);
      this.siguiente += 1;
    }
    const hayHueco = this.completos.size > 0 || this.aMedias.size > 0;
    if (!hayHueco) this.huecoDesde = null;
    else if (this.huecoDesde === null || listos.length > 0) this.huecoDesde = this.ahora();
    return listos;
  }

  /** Se llama con el latido: ¿lleva demasiado tiempo esperando algo que no llega? */
  revisar(): void {
    if (this.roto || this.huecoDesde === null) return;
    if (this.ahora() - this.huecoDesde > ESPERA_HUECO_MS) {
      this.roto = "Se perdió parte de un mensaje por el camino";
    }
  }
}

/**
 * Un extremo de una sesión del túnel: el navegador tiene uno, el Hub uno por
 * cada navegador conectado. No sabe nada de Supabase: recibe sobres con
 * `recibir` y los manda con la función que se le da. Así se prueba sin red.
 */
export class ExtremoTunel {
  private numero = 0;
  private entrada: Reensamblador;
  private ultimoDelOtro: number;
  private cerrado = false;

  alMensaje: ((texto: string) => void) | null = null;
  alCerrar: ((motivo: string) => void) | null = null;

  constructor(
    readonly sesion: string,
    /** Mi sentido al enviar. El del otro es el contrario. */
    private propio: SentidoTunel,
    private mandar: (sobre: SobreTunel) => void,
    private ahora: () => number = Date.now,
  ) {
    this.entrada = new Reensamblador(ahora);
    this.ultimoDelOtro = ahora();
  }

  get abierto(): boolean {
    return !this.cerrado;
  }

  enviar(texto: string): void {
    if (this.cerrado) return;
    for (const f of fragmentar(this.sesion, this.propio, this.numero, texto)) this.mandar(f);
    this.numero += 1;
  }

  control(k: ControlTunel["k"], motivo?: string): void {
    if (this.cerrado) return;
    this.mandar({ s: this.sesion, d: this.propio, k, ...(motivo ? { motivo } : {}) });
  }

  /** Un sobre de esta sesión que viene del otro lado. */
  recibir(sobre: SobreTunel): void {
    if (this.cerrado || sobre.s !== this.sesion || sobre.d === this.propio) return;
    this.ultimoDelOtro = this.ahora();

    if (esControl(sobre)) {
      if (sobre.k === "cerrar") this.terminar(sobre.motivo ?? "El otro lado cerró la sesión", false);
      return;
    }
    for (const texto of this.entrada.agregar(sobre)) this.alMensaje?.(texto);
    if (this.entrada.roto) this.cerrar(this.entrada.roto);
  }

  /** Llamar cada `LATIDO_MS`: late, y cierra si el otro calla o falta algo. */
  latir(): void {
    if (this.cerrado) return;
    this.entrada.revisar();
    if (this.entrada.roto) return this.cerrar(this.entrada.roto);
    if (this.ahora() - this.ultimoDelOtro > SILENCIO_MAXIMO_MS) {
      return this.terminar("El otro lado dejó de responder", false);
    }
    this.control("latido");
  }

  /** Cierra avisando al otro lado. */
  cerrar(motivo: string): void {
    this.terminar(motivo, true);
  }

  private terminar(motivo: string, avisar: boolean): void {
    if (this.cerrado) return;
    if (avisar) this.control("cerrar", motivo);
    this.cerrado = true;
    this.alCerrar?.(motivo);
  }
}
