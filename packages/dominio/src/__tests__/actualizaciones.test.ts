/**
 * Las actualizaciones remotas.
 *
 * Lo que hay que probar no es que descargue: es que NO REINICIE UN VIERNES A LAS
 * NUEVE. Una actualización que llega en mal momento cuesta un servicio entero, y
 * eso es peor que cualquier mejora que traiga.
 *
 * Y lo otro: que un aviso aplazado NO desaparezca. Una actualización que se
 * pospone y se olvida es una actualización que nunca se instala.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generarPar, type ParDeLlaves } from "../comun/firma.js";
import {
  MAS_TARDE_MS,
  FRESCURA_MAX_MS,
  aceptarManifiesto,
  aplazar,
  compararVersiones,
  cuandoRecordar,
  debeAvisar,
  estadoInicial,
  firmarVersion,
  hayNovedad,
  hayPendiente,
  instaladaPorDebajoDelMinimo,
  marcarInstalada,
  puedeInstalarse,
  registrarDisponible,
  resumenDeEleccion,
  verificarVersion,
  type VersionDisponible,
} from "../organizacion/actualizaciones.js";

let MOTRAE: ParDeLlaves;
let ATACANTE: ParDeLlaves;

beforeAll(async () => {
  MOTRAE = await generarPar();
  ATACANTE = await generarPar();
});
/* Viernes 24 de julio de 2026, 21:00 — plena cena. */
const VIERNES_21H = new Date(2026, 6, 24, 21, 0).getTime();

function version(v = "1.4.0", extra: Partial<VersionDisponible> = {}): VersionDisponible {
  return {
    version: v,
    notas: "Cortes más rápidos y arreglo del ticket de cocina.",
    url: `https://github.com/motrae/motrest/releases/download/v${v}/MotRest_setup.exe`,
    sha256: "a".repeat(64),
    publicado_ts: VIERNES_21H - 86_400_000,
    firma: "sin-firmar",
    ...extra,
  };
}

// --- Qué versión es más nueva ---------------------------------------------------------------

describe("saber qué versión es más nueva", () => {
  /*
   * EL BUG CLÁSICO. En orden alfabético "1.10.0" es MENOR que "1.9.0", y el
   * restaurante se queda clavado en la versión vieja sin que nadie entienda por
   * qué. Se compara por partes numéricas.
   */
  it("1.10.0 es más nueva que 1.9.0, aunque en texto no lo parezca", () => {
    expect(compararVersiones("1.10.0", "1.9.0")).toBe(1);
    expect(hayNovedad("1.9.0", "1.10.0")).toBe(true);
  });

  it("la misma versión no es novedad", () => {
    expect(compararVersiones("1.4.0", "1.4.0")).toBe(0);
    expect(hayNovedad("1.4.0", "1.4.0")).toBe(false);
  });

  it("no se ofrece una versión más vieja que la instalada", () => {
    expect(hayNovedad("2.0.0", "1.9.9")).toBe(false);
  });

  it("la 'v' delante y las partes que faltan no estorban", () => {
    expect(compararVersiones("v1.4", "1.4.0")).toBe(0);
    expect(compararVersiones("1.4.1", "v1.4")).toBe(1);
  });
});

// --- Cuándo se instala ----------------------------------------------------------------------

describe("cuándo se puede instalar", () => {
  /*
   * EL CANDADO MÁS IMPORTANTE DEL ARCHIVO. Un turno abierto es dinero contado a
   * medias: reiniciar ahí deja un arqueo que no cuadra y nadie sabe por qué. Se
   * comprueba AUNQUE el restaurante haya dicho "instala ahora", porque quien
   * elige eso a las nueve de la noche no está pensando en las doce mesas.
   */
  it("con la caja abierta NO se instala, aunque lo hayan pedido", () => {
    const v = puedeInstalarse(true, false);
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("turno_abierto");
  });

  it("en horario de servicio tampoco", () => {
    const v = puedeInstalarse(false, true);
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("horario_de_servicio");
  });

  it("con la caja cerrada y fuera de servicio, adelante", () => {
    expect(puedeInstalarse(false, false).puede).toBe(true);
  });
});

// --- Aplazar --------------------------------------------------------------------------------

describe("cuando el restaurante lo pospone", () => {
  it("«más tarde» son dos horas: lo que dura un servicio", () => {
    expect(cuandoRecordar({ cuando: "mas_tarde" }, VIERNES_21H)).toBe(VIERNES_21H + MAS_TARDE_MS);
  });

  it("«a las 23:00» es esta noche si todavía no han dado", () => {
    const esperado = new Date(2026, 6, 24, 23, 0).getTime();
    expect(cuandoRecordar({ cuando: "a_las", hora: 23 }, VIERNES_21H)).toBe(esperado);
  });

  /*
   * Si la hora elegida YA PASÓ hoy, es la de mañana. Sin esto, quien elige una
   * hora pasada ve el aviso reaparecer al instante y siente que el sistema no le
   * hizo caso.
   */
  it("«a las 8:00» a las nueve de la noche es mañana, no ahorita", () => {
    const manana = new Date(2026, 6, 25, 8, 0).getTime();
    expect(cuandoRecordar({ cuando: "a_las", hora: 8 }, VIERNES_21H)).toBe(manana);
  });

  it("aplazada, no vuelve a preguntar hasta que toca", () => {
    const estado = aplazar(registrarDisponible(estadoInicial(), version(), VIERNES_21H), { cuando: "mas_tarde" }, VIERNES_21H);

    expect(debeAvisar(estado, VIERNES_21H + 60_000)).toBe(false);
    expect(debeAvisar(estado, VIERNES_21H + MAS_TARDE_MS + 1)).toBe(true);
  });

  /*
   * LO QUE PIDIÓ GONZALO Y ES LO CORRECTO: el aviso se queda puesto en el
   * software aunque esté aplazado. Un aviso que desaparece al posponerlo es un
   * aviso que nadie vuelve a ver.
   */
  it("aplazada NO significa desaparecida: el aviso sigue puesto", () => {
    const estado = aplazar(registrarDisponible(estadoInicial(), version(), VIERNES_21H), { cuando: "a_las", hora: 23 }, VIERNES_21H);

    expect(debeAvisar(estado, VIERNES_21H)).toBe(false);
    expect(hayPendiente(estado)).toBe(true);
    expect(resumenDeEleccion(estado)).toContain("se instalará a las 23:00");
  });

  /* Lo obligatorio no se pospone: para eso existe la marca. */
  it("una versión obligatoria avisa aunque la hayan aplazado", () => {
    const estado = aplazar(
      registrarDisponible(estadoInicial(), version("1.4.0", { obligatoria: true }), VIERNES_21H),
      { cuando: "mas_tarde" },
      VIERNES_21H,
    );
    expect(debeAvisar(estado, VIERNES_21H)).toBe(true);
  });

  /*
   * Quien pospone hasta mañana la 1.4 tiene que ver la 1.5 que salió esta noche
   * por un fallo grave. El aplazamiento era para AQUELLA versión.
   */
  it("una versión nueva borra el aplazamiento de la anterior", () => {
    const aplazada = aplazar(registrarDisponible(estadoInicial(), version("1.4.0"), VIERNES_21H), { cuando: "a_las", hora: 8 }, VIERNES_21H);
    const conNueva = registrarDisponible(aplazada, version("1.5.0"), VIERNES_21H);

    expect(conNueva.aplazada_hasta).toBeUndefined();
    expect(debeAvisar(conNueva, VIERNES_21H)).toBe(true);
  });

  it("volver a ver la MISMA versión respeta lo que ya eligieron", () => {
    const aplazada = aplazar(registrarDisponible(estadoInicial(), version("1.4.0"), VIERNES_21H), { cuando: "a_las", hora: 8 }, VIERNES_21H);
    const otraVez = registrarDisponible(aplazada, version("1.4.0"), VIERNES_21H + 60_000);

    expect(otraVez.aplazada_hasta).toBe(aplazada.aplazada_hasta);
  });

  it("sin nada pendiente no se avisa de nada", () => {
    expect(debeAvisar(estadoInicial(), VIERNES_21H)).toBe(false);
    expect(hayPendiente(estadoInicial())).toBe(false);
  });

  it("instalada, el aviso se va", () => {
    const estado = registrarDisponible(estadoInicial(), version("1.4.0"), VIERNES_21H);
    expect(hayPendiente(marcarInstalada(estado, "1.4.0"))).toBe(false);
  });

  /* Instalar la 1.4 mientras ya se anunció la 1.5 no debe borrar el aviso de la 1.5. */
  it("instalar una versión vieja no tapa la nueva que ya se anunció", () => {
    const estado = registrarDisponible(estadoInicial(), version("1.5.0"), VIERNES_21H);
    expect(hayPendiente(marcarInstalada(estado, "1.4.0"))).toBe(true);
  });
});

// --- La firma -------------------------------------------------------------------------------

describe("de dónde viene la actualización", () => {
  /*
   * EL CANDADO DE SEGURIDAD DEL PROYECTO ENTERO. El canal de actualización es la
   * llave maestra de todas las instalaciones: quien pueda publicar por él manda
   * en todos los restaurantes a la vez. Ni siquiera hace falta confiar en
   * GitHub — si alguien tomara la cuenta, sin el secreto no cuela nada.
   */
  it("un manifiesto firmado por MOTRAE se verifica", async () => {
    const firmada = await firmarVersion(version(), MOTRAE.privada);
    expect(await verificarVersion(firmada, MOTRAE.publica)).toBe(true);
  });

  it("cambiar la URL del instalador invalida la firma", async () => {
    const firmada = await firmarVersion(version(), MOTRAE.privada);
    const suplantada = { ...firmada, url: "https://sitio-de-un-atacante.mx/virus.exe" };
    expect(await verificarVersion(suplantada, MOTRAE.publica)).toBe(false);
  });

  it("cambiar la huella del archivo también", async () => {
    const firmada = await firmarVersion(version(), MOTRAE.privada);
    expect(await verificarVersion({ ...firmada, sha256: "b".repeat(64) }, MOTRAE.publica)).toBe(false);
  });

  /* Ni colarse marcando como obligatoria una versión que no lo era. */
  it("marcarla obligatoria por su cuenta invalida la firma", async () => {
    const firmada = await firmarVersion(version(), MOTRAE.privada);
    expect(await verificarVersion({ ...firmada, obligatoria: true }, MOTRAE.publica)).toBe(false);
  });

  it("otra llave privada no puede publicar", async () => {
    const falsa = await firmarVersion(version(), ATACANTE.privada);
    expect(await verificarVersion(falsa, MOTRAE.publica)).toBe(false);
  });

  it("una firma con basura no revienta, solo dice que no", async () => {
    expect(await verificarVersion(version("1.4.0", { firma: "" }), MOTRAE.publica)).toBe(false);
  });
});

describe("frescura y anti-reversión del canal", () => {
  it("no acepta un publicado_ts anterior al último que ya vio", () => {
    const r = aceptarManifiesto(
      version("1.6.0", { publicado_ts: VIERNES_21H - 2 }),
      { ultimo_publicado_ts: VIERNES_21H - 1 },
      "1.4.0",
      VIERNES_21H,
    );
    expect(r.aceptar).toBe(false);
    if (!r.aceptar) expect(r.razon).toContain("reversión");
  });

  it("rechaza un manifiesto firmado pero demasiado viejo", () => {
    const r = aceptarManifiesto(
      version("1.6.0", { publicado_ts: VIERNES_21H - FRESCURA_MAX_MS - 1 }),
      {},
      "1.4.0",
      VIERNES_21H,
    );
    expect(r.aceptar).toBe(false);
    if (!r.aceptar) expect(r.razon).toContain("demasiado viejo");
  });

  it("el mínimo soportado hace visible que la instalada ya no es segura", () => {
    const r = aceptarManifiesto(
      version("1.6.0", { version_minima_soportada: "1.5.0" }),
      {},
      "1.4.0",
      VIERNES_21H,
    );
    expect(r).toEqual({ aceptar: true, instalada_por_debajo_del_minimo: true });
    expect(instaladaPorDebajoDelMinimo("1.5.0", "1.5.0")).toBe(false);
  });

  it("no admite que un manifiesto anuncie un mínimo mayor que él mismo", () => {
    const r = aceptarManifiesto(
      version("1.5.0", { version_minima_soportada: "1.6.0" }),
      {},
      "1.4.0",
      VIERNES_21H,
    );
    expect(r.aceptar).toBe(false);
  });
});
