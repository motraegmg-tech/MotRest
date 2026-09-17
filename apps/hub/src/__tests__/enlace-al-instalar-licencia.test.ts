/**
 * Que pegar una licencia MONTE el enlace con MOTRAE, sin reiniciar el Hub.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El enlace de un local con la nube viaja dentro de
 * su licencia firmada (`nube: { url, clave }`). Sin él, ese restaurante no
 * reporta su pulso, no recibe renovaciones y no se le puede cortar el servicio
 * en remoto: hay que ir físicamente a su caja. Los locales dados de alta antes
 * del 28-ago-2026 tienen licencias SIN ese bloque, y la única salida es pegarles
 * una licencia nueva que sí lo traiga.
 *
 * Y eso no funcionaba. `conectarConLaNube()` corría UNA vez, al arrancar. Al
 * pegar la licencia el Hub la instalaba, contestaba `ok`, la difundía a las
 * terminales... y el enlace no se montaba. El local seguía mudo hasta que
 * alguien reiniciara el Hub, y nada en pantalla lo decía. De tres locales, uno
 * solo había reportado alguna vez.
 *
 * QUÉ SE PRUEBA Y CÓMO. En dos mitades, porque `main.ts` no se puede importar:
 * hacerlo arranca el Hub entero —abre la base, escucha puertos, lanza
 * respaldos—, y por eso el resto de pruebas de este directorio replican su
 * forma en vez de cargarlo (ver `identidad-y-registro.test.ts` y
 * `peticion-malformada.test.ts`).
 *
 *   1. La conducta, sobre una réplica de la decisión y de lo que se hace con
 *      ella, con un enlace de mentira que cuenta aperturas y cierres. Aquí se
 *      fija lo que importa: que se monte cuando falta, y **que NO se rehaga
 *      cuando no cambió nada** — rehacerlo tira la suscripción de Realtime que
 *      escucha las renovaciones, y la que llegara en ese instante se perdería.
 *
 *   2. El cableado, leyendo `main.ts` como texto. Una réplica no puede
 *      demostrar que los dos caminos de instalación llamen de verdad a la
 *      función, y el defecto original era exactamente ése: la lógica no
 *      faltaba, faltaba el cable.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { pareceNubeSupabase } from "../enlace-supabase.js";

const NUBE = "https://ixttslqbbwqfcqjmttyg.supabase.co";
const OTRA_NUBE = "https://zzzzzzzzzzzzzzzzzzzz.supabase.co";
const SUC = "suc-rodizio-centro";

// --- Réplica de la decisión de `main.ts` --------------------------------------------------------

type DecisionDeEnlace = "sin_nube" | "montar" | "sin_cambios" | "rehacer";

/** Réplica de `decidirEnlaceDeNube()`. */
function decidirEnlaceDeNube(
  montadoCon: { url: string; clave: string; sucursal: string } | null,
  destino: { url?: string; clave?: string; sucursal: string },
): DecisionDeEnlace {
  if (!destino.url || !destino.clave) return "sin_nube";
  if (!montadoCon) return "montar";
  if (
    montadoCon.url === destino.url &&
    montadoCon.clave === destino.clave &&
    montadoCon.sucursal === destino.sucursal
  ) {
    return "sin_cambios";
  }
  return "rehacer";
}

// --- Un Hub de mentira, con un enlace que se deja contar ----------------------------------------

/**
 * Lo único que le pide esta prueba a un enlace: abrirse, cerrarse y decir con
 * qué se abrió. La suscripción de Realtime se representa con `conexiones`: si
 * ese número sube cuando no debía, es que se tiró la que estaba escuchando.
 */
class EnlaceDeMentira {
  conexiones = 0;
  cierres = 0;
  private vivo = false;

  constructor(
    readonly url: string,
    readonly clave: string,
    readonly sucursal: string,
  ) {}

  conectar(): void {
    this.conexiones += 1;
    this.vivo = true;
  }

  desconectar(): void {
    this.cierres += 1;
    this.vivo = false;
  }

  conectado(): boolean {
    return this.vivo;
  }
}

/**
 * Réplica del estado del Hub y de las dos funciones que lo mueven:
 * `conectarConLaNube()` (montar) y `unaVueltaDeEnlace()` (decidir y aplicar).
 *
 * Se replica el ORDEN, que es donde estaban los errores posibles: comprobar
 * antes de tumbar, cerrar antes de abrir, y no dejar la cola de avisos colgando
 * de un enlace ya cerrado.
 */
function hubDeMentira(opciones: { sucursal?: string; conLlavePublicable?: boolean } = {}) {
  const hub = {
    /** Lo que trae la licencia instalada, `null` si no trae bloque `nube`. */
    licencia: null as { url: string; clave: string } | null,
    sucursal: opciones.sucursal ?? SUC,
    llavePublicable: opciones.conLlavePublicable ?? true,
    /** Una actualización en curso: no se toca el canal a media instalación. */
    instalando: false,

    enlace: null as EnlaceDeMentira | null,
    montadoCon: null as { url: string; clave: string; sucursal: string } | null,
    /** De qué enlace cuelga la cola de avisos. Debe ser siempre el vivo. */
    avisosDe: null as EnlaceDeMentira | null,

    montando: false,
    reconsiderando: false,
    otraVez: false,
    /** Cuántos relojes de pulso se pusieron. Nunca más de uno por proceso. */
    relojesDePulso: 0,
    /** Cuántas veces se reconstruyó el canal de actualizaciones. */
    canalRehecho: 0,
    bitacora: [] as string[],
    /** Todos los enlaces que existieron, para comprobar que solo uno quedó vivo. */
    historia: [] as EnlaceDeMentira[],
  };

  const registrar = (nivel: string, texto: string) => hub.bitacora.push(`${nivel}: ${texto}`);

  /** Réplica de `conectarConLaNube()`: el candado de un solo enlace vivo. */
  async function conectarConLaNube(): Promise<void> {
    if (hub.montando) return;
    hub.montando = true;
    try {
      await montar();
    } finally {
      hub.montando = false;
    }
  }

  async function montar(): Promise<void> {
    // El `await` está aquí a propósito: en `main.ts` esto lee el almacén, y ese
    // hueco es por donde se colaba la segunda licencia.
    await Promise.resolve();
    const url = hub.licencia?.url;
    const clave = hub.licencia?.clave;
    if (!url || !clave) {
      registrar("aviso", "Sin enlace con MOTRAE: este local no reportará su pulso.");
      return;
    }
    if (!pareceNubeSupabase(url) || !hub.llavePublicable) {
      registrar("error", `La dirección de MOTRAE («${url}») no sirve.`);
      return;
    }

    const nuevo = new EnlaceDeMentira(url, clave, hub.sucursal);
    hub.enlace = nuevo;
    hub.historia.push(nuevo);
    hub.montadoCon = { url, clave, sucursal: hub.sucursal };
    hub.avisosDe = nuevo;
    nuevo.conectar();

    if (hub.relojesDePulso === 0) hub.relojesDePulso = 1;
  }

  /** Réplica de `unaVueltaDeEnlace()`. */
  async function unaVuelta(esperaAntesDeCerrar = 0): Promise<void> {
    const destino = { ...(hub.licencia ?? {}), sucursal: hub.sucursal };
    const decision = decidirEnlaceDeNube(hub.enlace ? hub.montadoCon : null, destino);

    if (decision === "sin_nube" || decision === "sin_cambios") return;

    if (decision === "rehacer") {
      if (!pareceNubeSupabase(destino.url!) || !hub.llavePublicable) {
        registrar(
          "error",
          `La licencia nueva apunta a «${destino.url}», que este Hub no puede usar. ` +
            "Se conserva el enlace anterior.",
        );
        return;
      }
      if (esperaAntesDeCerrar > 0) {
        await new Promise((seguir) => setTimeout(seguir, esperaAntesDeCerrar));
      }
      registrar("info", "La licencia nueva cambia por dónde habla este local con MOTRAE.");
      hub.enlace?.desconectar();
      hub.enlace = null;
      hub.montadoCon = null;
      hub.avisosDe = null;
    }

    await conectarConLaNube();
    if (!hub.enlace) return;

    registrar("info", "Enlace con MOTRAE establecido desde la licencia nueva, sin reiniciar nada.");
    if (hub.instalando) return;
    hub.canalRehecho += 1;
  }

  /** Réplica de `reconsiderarEnlaceDeNube()`, con su candado y su reenganche. */
  async function reconsiderar(esperaAntesDeCerrar = 0): Promise<void> {
    if (hub.reconsiderando) {
      hub.otraVez = true;
      return;
    }
    hub.reconsiderando = true;
    try {
      do {
        hub.otraVez = false;
        await unaVuelta(esperaAntesDeCerrar);
      } while (hub.otraVez);
    } finally {
      hub.reconsiderando = false;
    }
  }

  return { hub, conectarConLaNube, reconsiderar };
}

// --- 1. La conducta -----------------------------------------------------------------------------

describe("instalar una licencia y el enlace con MOTRAE", () => {
  it("monta el enlace en un Hub que arrancó sin él", async () => {
    // El caso de Gonzalo esta semana: un local de los viejos, con licencia sin
    // bloque `nube`, al que se le pega una licencia nueva que sí lo trae.
    const { hub, conectarConLaNube, reconsiderar } = hubDeMentira();

    await conectarConLaNube(); // el arranque, con la licencia vieja
    expect(hub.enlace).toBeNull();
    expect(hub.bitacora.join("\n")).toContain("Sin enlace con MOTRAE");

    hub.licencia = { url: NUBE, clave: "credencial-de-rodizio" };
    await reconsiderar();

    expect(hub.enlace).not.toBeNull();
    expect(hub.enlace!.conexiones).toBe(1);
    expect(hub.montadoCon).toEqual({ url: NUBE, clave: "credencial-de-rodizio", sucursal: SUC });
    expect(hub.bitacora.join("\n")).toContain("sin reiniciar nada");
  });

  it("y no hace falta reiniciar: el proceso es el mismo de antes", async () => {
    // Dicho de otro modo: montarlo no pasa por volver a arrancar nada. El Hub
    // sostiene la LAN, las impresoras y el SQLite del local; reiniciarlo a
    // media captura tira comandas.
    const { hub, conectarConLaNube, reconsiderar } = hubDeMentira();
    await conectarConLaNube();
    const relojesAlArrancar = hub.relojesDePulso;

    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();

    // Un solo reloj de pulso en toda la vida del proceso, aunque `montar()`
    // haya corrido dos veces: un temporizador por licencia pegada sería un
    // parte de más al día por cada vez.
    expect(relojesAlArrancar).toBe(0);
    expect(hub.relojesDePulso).toBe(1);
  });

  it("NO lo vuelve a montar si la licencia trae el mismo enlace", async () => {
    // Éste es el candado que de verdad cuesta dinero. Reconectar por gusto tira
    // la suscripción de Realtime que está escuchando renovaciones: una que
    // llegara justo en ese hueco se perdería, y el local se quedaría bloqueado
    // por falta de pago habiendo pagado.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();

    const elDeSiempre = hub.enlace!;
    const renglones = hub.bitacora.length;

    // Llega otra vez la misma licencia (es lo normal: MOTRAE reenvía).
    await reconsiderar();

    expect(hub.enlace).toBe(elDeSiempre);
    expect(elDeSiempre.conexiones).toBe(1);
    expect(elDeSiempre.cierres).toBe(0);
    expect(hub.canalRehecho).toBe(1);
    // Ni siquiera ensucia la bitácora: no pasó nada que contar.
    expect(hub.bitacora.length).toBe(renglones);
  });

  it("rehace el enlace si la licencia cambia la nube, cerrando el anterior", async () => {
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();
    const viejo = hub.enlace!;

    hub.licencia = { url: OTRA_NUBE, clave: "c" };
    await reconsiderar();

    expect(viejo.cierres).toBe(1);
    expect(hub.enlace).not.toBe(viejo);
    expect(hub.enlace!.url).toBe(OTRA_NUBE);
    // La cola de avisos cuelga del vivo, no del cerrado: si se quedara con el
    // viejo, seguiría mandando por una puerta cerrada.
    expect(hub.avisosDe).toBe(hub.enlace);
  });

  it("también lo rehace si le rotaron la credencial", async () => {
    // MOTRAE puede cambiarle la clave a un local sin cambiarle la nube. Sin
    // esto, el enlace seguiría abierto con una credencial que ya no vale.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "vieja" };
    await reconsiderar();
    const viejo = hub.enlace!;

    hub.licencia = { url: NUBE, clave: "nueva" };
    await reconsiderar();

    expect(viejo.cierres).toBe(1);
    expect(hub.enlace!.clave).toBe("nueva");
  });

  it("y si la licencia da de alta al equipo en otro restaurante", async () => {
    // El enlace se autentica como un restaurante concreto. Si la licencia le
    // fija otra identidad al equipo, el enlace abierto estaría reportando en
    // nombre de quien no es.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();
    const viejo = hub.enlace!;

    hub.sucursal = "suc-el-otro-restaurante";
    await reconsiderar();

    expect(viejo.cierres).toBe(1);
    expect(hub.enlace!.sucursal).toBe("suc-el-otro-restaurante");
  });

  it("no toca nada si la licencia no trae datos de nube", async () => {
    // Un local que opera solo con el portal es un caso normal, no un error.
    const { hub, reconsiderar } = hubDeMentira();
    await reconsiderar();

    expect(hub.enlace).toBeNull();
    expect(hub.historia).toHaveLength(0);
    expect(hub.bitacora).toHaveLength(0);
  });

  it("conserva el enlace bueno si la licencia nueva apunta a algo que no sirve", async () => {
    // Tumbar el enlace que funciona y descubrir después que la dirección nueva
    // no vale dejaría al local peor de lo que estaba: sin pulso y sin nadie
    // mirando.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();
    const bueno = hub.enlace!;

    hub.licencia = { url: "ws://relay.motrae.example/hub", clave: "c" };
    await reconsiderar();

    expect(hub.enlace).toBe(bueno);
    expect(bueno.cierres).toBe(0);
    expect(hub.bitacora.join("\n")).toContain("Se conserva el enlace anterior");
  });

  it("dos licencias a la vez no dejan dos enlaces vivos", async () => {
    // Sin candado, el `await` de dentro deja entrar a la segunda antes de que
    // la primera haya guardado su enlace: dos suscripciones de Realtime, dos
    // pulsos y dos manos confirmando la misma licencia.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };

    await Promise.all([reconsiderar(), reconsiderar()]);

    expect(hub.historia).toHaveLength(1);
    expect(hub.historia[0]!.conexiones).toBe(1);
    expect(hub.enlace).toBe(hub.historia[0]);
  });

  it("una licencia que llega mientras se decide no se pierde", async () => {
    // Se apunta y se vuelve a decidir al terminar. Descartarla dejaría al local
    // apuntando a la nube vieja sin que nada lo dijera — y ése es exactamente
    // el fallo silencioso que todo esto viene a quitar.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };

    const primera = reconsiderar();
    hub.licencia = { url: OTRA_NUBE, clave: "c" };
    const segunda = reconsiderar();
    await Promise.all([primera, segunda]);

    // Manda la última licencia instalada, venga cuando venga.
    expect(hub.enlace!.url).toBe(OTRA_NUBE);
    // Y por el camino no se quedó ningún enlace abierto sin dueño: los datos se
    // releen DESPUÉS del `await`, así que la segunda licencia alcanzó al montaje
    // en vuelo en vez de provocar un segundo enlace.
    expect(hub.historia.filter((e) => e.conectado())).toEqual([hub.enlace]);
    for (const e of hub.historia) expect(e.conexiones).toBe(1);
  });

  it("no rehace el canal de actualizaciones a media instalación", async () => {
    // Cambiarle el buscador debajo le quitaría de las manos el instalador que
    // acaba de descargar y verificar.
    const { hub, reconsiderar } = hubDeMentira();
    hub.instalando = true;
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();

    expect(hub.enlace).not.toBeNull();
    expect(hub.canalRehecho).toBe(0);
  });

  it("espera antes de cerrar cuando la licencia llegó por el propio enlace", async () => {
    // El enlace viejo todavía tiene que escribir por ahí la confirmación de que
    // la licencia se instaló. Cortándolo antes, MOTRAE no la vería nunca y
    // reenviaría la licencia en cada conexión, para siempre.
    const { hub, reconsiderar } = hubDeMentira();
    hub.licencia = { url: NUBE, clave: "c" };
    await reconsiderar();
    const viejo = hub.enlace!;

    hub.licencia = { url: OTRA_NUBE, clave: "c" };
    const empezo = Date.now();
    await reconsiderar(30);

    expect(Date.now() - empezo).toBeGreaterThanOrEqual(25);
    expect(viejo.cierres).toBe(1);
  });
});

// --- 2. El cableado, sobre el `main.ts` de verdad ------------------------------------------------

/**
 * Esto es lo que la réplica no puede probar y era el defecto entero: la lógica
 * existía, faltaba llamarla desde los dos caminos de instalación. Se lee el
 * archivo como texto porque importarlo arranca el Hub.
 */
const FUENTE = readFileSync(fileURLToPath(new URL("../main.ts", import.meta.url)), "utf8");

/** El trozo de `main.ts` que va de un ancla a otro. */
function trozo(desde: string, hasta: string): string {
  const inicio = FUENTE.indexOf(desde);
  expect(inicio, `no se encontró en main.ts: ${desde}`).toBeGreaterThan(-1);
  const fin = FUENTE.indexOf(hasta, inicio + desde.length);
  expect(fin, `no se encontró en main.ts: ${hasta}`).toBeGreaterThan(-1);
  return FUENTE.slice(inicio, fin);
}

describe("los dos caminos de instalación llaman a reconsiderar el enlace", () => {
  it("el de pegarla a mano en la caja (POST /licencia)", () => {
    const manejador = trozo("const r = await licencia!.instalar(JSON.parse(", "} catch (causa) {");
    expect(manejador).toContain("difundirLicencia()");
    expect(manejador).toContain("reconsiderarEnlaceDeNube(");
  });

  it("el de la licencia que llega sola por la nube", () => {
    const funcion = trozo("async function instalarLicenciaDeMotrae(", "\n/**");
    expect(funcion).toContain("reconsiderarEnlaceDeNube(");
    // Con demora: quien llamó todavía tiene que dejar el acuse por ese enlace.
    expect(funcion).toContain("ESPERA_ANTES_DE_CERRAR_MS");
  });

  it("y el enlace no puede montarse dos veces a la vez", () => {
    const funcion = trozo("async function conectarConLaNube(", "async function montarEnlaceDeNube(");
    expect(funcion).toContain("if (montandoEnlace) return;");
    expect(funcion).toContain("finally");
  });

  it("el reloj del pulso se pone una sola vez, aunque se remonte el enlace", () => {
    const funcion = trozo("async function montarEnlaceDeNube(", "\n/**");
    expect(funcion).toContain("if (!relojDePulsoPuesto)");
  });

  it("el enlace solo sale de una licencia verificada", () => {
    // `licencia.enlaceNube` devuelve el bloque solo si la licencia está
    // verificada. Si alguien resolviera la nube leyendo el JSON crudo, bastaría
    // con dejar un archivo en la carpeta para apuntar el latido de un
    // restaurante a un servidor cualquiera.
    const funcion = trozo("async function dondeReportaEsteLocal(", "\n/**");
    expect(funcion).toContain("licencia?.enlaceNube");
    expect(funcion).not.toContain("JSON.parse");
  });
});
