/**
 * ENSAYO CONTRA EL HUB INSTALADO.
 *
 * `apps/hub/src/__tests__/sincronizacion.test.ts` prueba el Hub con conexiones
 * de mentira. Esto es otra cosa: levanta el **binario instalado** —el mismo
 * archivo que va a estar en Rodizio— y le habla por WebSocket real, con cifrado
 * real. Lo que se ejercita aquí es lo que ninguna prueba unitaria toca: el
 * empaquetado, el transporte y el arranque en frío.
 *
 * Reproduce el día completo: alta de las dos terminales desde un local vacío,
 * servicio, apagón del enlace del móvil —que sigue vendiendo en isla— y
 * reconexión. Al final todo tiene que cuadrar SIN DUPLICADOS.
 *
 * No es una prueba de CI: necesita el binario instalado. Se corre a mano antes
 * de un despliegue.
 *
 *     corepack pnpm@9.15.0 --filter @motrest/hub ensayo
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  FabricaEventos,
  permisosDePlantilla,
  pesos,
  streamIdentidad,
  type EventoComanda,
  type EventoIdentidad,
} from "@motrest/dominio";
import { ClienteSync, almacenEnMemoria, type Almacen, type SocketLike } from "@motrest/protocolo-sync";

/**
 * El Hub INSTALADO, el mismo binario que va a Rodizio.
 *
 * Se levanta una instancia aparte, con base de datos limpia y puerto propio: el
 * ensayo mete ventas de mentira y no tiene por qué ensuciar el registro real del
 * restaurante. Además, con el local vacío se ejercita el alta de terminales
 * desde cero, que es exactamente lo que pasa el día de la instalación.
 */
const BINARIO =
  process.env.MOTREST_HUB_EXE ?? join(process.env.LOCALAPPDATA ?? "", "MotRest", "motrest-hub.exe");
const PUERTO = 8797;
const HUB_HTTP = `http://localhost:${PUERTO + 1}`;
const SUCURSAL = "suc-rodizio";

/**
 * El propietario que se declara a sí mismo, y el cajero que él da de alta.
 *
 * El móvil es CAJERO y no mesero porque en este ensayo cobra, y `pos.cobro.registrar`
 * no está en la plantilla del mesero — con razón: quien sirve la mesa no es quien
 * toca el dinero. Con un mesero, el Hub rechazaba cada cobro y el ensayo lo leía
 * como una caída del enlace.
 */
const PROPIETARIO = "usr-gonzalo";
const CAJERO = "usr-cajero";

/**
 * Una IPv4 privada de este equipo, para que el «móvil» entre como entra de
 * verdad: por la red.
 *
 * Hace falta porque el Hub decide si una terminal es la caja mirando la
 * DIRECCIÓN DE ORIGEN, no el puerto (`esPeticionLocal`). Conectando por
 * `localhost` —aunque sea al puerto con TLS— la tablet simulada llegaría como
 * loopback, el Hub la tomaría por la propia caja y la autorizaría sola: el
 * ensayo dejaría de comprobar justo lo que quiere comprobar.
 */
function ipDeLan(): string | null {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const red of interfaces ?? []) {
      if (red.family !== "IPv4" || red.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(red.address)) return red.address;
    }
  }
  return null;
}

let fallos = 0;

function comprobar(afirmacion: boolean, que: string, detalle = ""): void {
  const marca = afirmacion ? "  ok  " : " FALLA";
  console.log(`${marca}  ${que}${detalle ? `  — ${detalle}` : ""}`);
  if (!afirmacion) fallos++;
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Levanta el Hub instalado sobre un local vacío y espera a que responda. */
async function levantarHub(carpeta: string): Promise<ChildProcess> {
  const proceso = spawn(BINARIO, [], {
    env: {
      ...process.env,
      MOTREST_HUB_DB: join(carpeta, "hub.sqlite"),
      MOTREST_RESPALDOS: join(carpeta, "respaldos"),
      MOTREST_HUB_PUERTO: String(PUERTO),
      MOTREST_HUB_ID: "hub-ensayo",
      // Sin esto, un local vacío se inventa un `suc-XXXXXXXX` al azar y rechaza
      // los eventos de identidad del ensayo por pertenecer a otro stream.
      MOTREST_SUCURSAL_ID: SUCURSAL,
    },
    stdio: "ignore",
  });

  for (let intento = 0; intento < 40; intento++) {
    await esperar(250);
    try {
      await salud();
      return proceso;
    } catch {
      /* todavía no levanta */
    }
  }
  proceso.kill();
  throw new Error(`El Hub instalado no respondió en ${HUB_HTTP}. ¿Existe ${BINARIO}?`);
}

/** El Hub inyecta su url y su clave en el index que sirve a esta misma máquina. */
async function datosDelHub(): Promise<{ url: string; clave: string }> {
  const html = await (await fetch(`${HUB_HTTP}/`)).text();
  const m = html.match(/window\.__MOTREST_HUB__\s*=\s*(\{.*?\});/s);
  if (!m) throw new Error("El Hub no inyectó sus datos: ¿está sirviendo el POS?");
  return JSON.parse(m[1]!);
}

async function salud(): Promise<Record<string, unknown>> {
  return (await fetch(`${HUB_HTTP}/salud`)).json() as Promise<Record<string, unknown>>;
}

/** Una terminal del local: su almacén, su fábrica de eventos y su enlace. */
function terminal(
  deviceId: string,
  empleadoId: string,
  datos: { url: string; clave: string },
  /** Por dónde entra. La de red usa TLS con el certificado propio del Hub. */
  porLan: string | null = null,
) {
  const almacen: Almacen = almacenEnMemoria();
  const recibidos: string[] = [];

  const cliente = new ClienteSync({
    url: porLan ? `wss://${porLan}:${PUERTO}/sync` : datos.url,
    clave: datos.clave,
    device_id: deviceId,
    sucursal_id: SUCURSAL,
    almacen,
    // El Hub firma su propio certificado —no hay autoridad que lo avale en la
    // LAN de un restaurante—, así que aquí se acepta igual que lo acepta la
    // tablet tras el emparejamiento por QR.
    crearSocket: (url) =>
      new WebSocket(url, porLan ? { rejectUnauthorized: false } : undefined) as unknown as SocketLike,
    alRecibir: (eventos) => recibidos.push(...eventos.map((e) => e.id)),
    // Sin esto, un rechazo del Hub se ve igual que "no hay red": el ensayo diría
    // "isla" sin decir por qué, que es justo lo que no sirve al depurar.
    alCambiarEstado: (estado, detalle) => {
      console.log(`        [${deviceId}] ${estado}${detalle ? ` · ${detalle}` : ""}`);
    },
  });

  const fabrica = new FabricaEventos<EventoComanda>({
    device_id: deviceId,
    empleado_id: empleadoId,
    sucursal_id: SUCURSAL,
  });

  const fabricaIdentidad = new FabricaEventos<EventoIdentidad>({
    device_id: deviceId,
    empleado_id: empleadoId,
    sucursal_id: SUCURSAL,
  });

  /**
   * Da de alta a un usuario del local.
   *
   * El ensayo tiene que hacerlo porque ya NO hay propietario de fábrica: desde
   * que el restaurante crea su propia cuenta al instalar, un local recién
   * nacido no tiene ni un usuario, y el Hub rechaza con «Empleado desconocido»
   * cada evento que le llegue firmado por alguien que no existe. Antes esto
   * colaba porque las versiones viejas sembraban `usr-gonzalo` solas —el id
   * sigue ahí, en `USUARIO_RESPONSABLE_ID`, para migrar las cajas de entonces—.
   */
  async function crearUsuario(
    usuarioId: string,
    nombre: string,
    puesto: string,
    rolId: "propietario" | "cajero",
  ): Promise<void> {
    await almacen.eventos.anexar([
      fabricaIdentidad.crear("usuario_creado", streamIdentidad(SUCURSAL), {
        usuario_id: usuarioId,
        nombre,
        puesto,
        rol_id: rolId,
        permisos: permisosDePlantilla(rolId),
      }),
    ]);
  }

  /** Sirve y cobra una mesa: es lo que hace la terminal toda la noche. */
  async function vender(mesa: string, importe: number): Promise<string[]> {
    const orden = `ord-${deviceId}-${mesa}-${Date.now()}`;
    const eventos = [
      fabrica.crear("orden_creada", orden, { orden_id: orden, mesa_id: mesa, abierta_ts: Date.now() }),
      fabrica.crear("pago_registrado", orden, {
        orden_id: orden, monto: pesos(importe), forma: "efectivo",
      }),
      fabrica.crear("cuenta_cerrada", orden, { orden_id: orden }),
    ];
    await almacen.eventos.anexar(eventos);
    return eventos.map((e) => e.id);
  }

  return { deviceId, almacen, cliente, recibidos, vender, crearUsuario };
}

async function main(): Promise<void> {
  console.log("\n=== ENSAYO DEL VIERNES CONTRA EL HUB INSTALADO ===\n");
  console.log(`Binario: ${BINARIO}`);

  const carpeta = mkdtempSync(join(tmpdir(), "motrest-ensayo-"));
  const proceso = await levantarHub(carpeta);

  const antes = await salud();
  console.log(`Hub ${antes.hub_id} · local vacío · seq ${antes.seq}\n`);

  const datos = await datosDelHub();
  console.log(`Enlace local: ${datos.url}\n`);

  const lan = ipDeLan();
  console.log(lan ? `Móvil por la red: ${lan}\n` : "Sin IPv4 privada: el móvil entrará por loopback\n");

  const caja = terminal("dev-caja-ensayo", PROPIETARIO, datos);
  const movil = terminal("dev-movil-ensayo", CAJERO, datos, lan);

  // --- El día de la instalación: dar de alta las terminales ----------------------------
  await caja.cliente.conectar();
  await esperar(700);
  comprobar(
    caja.cliente.estado === "sincronizado",
    "la PRIMERA terminal del local queda autorizada sola",
    caja.cliente.estado,
  );

  // --- Y dar de alta a las personas ----------------------------------------------------
  // Un local recién instalado no tiene usuarios: el primero se declara a sí
  // mismo como propietario —es el único arranque de confianza que el Hub
  // permite— y a partir de ahí él firma las altas de los demás.
  await caja.crearUsuario(PROPIETARIO, "Gonzalo DJA", "Responsable del restaurante", "propietario");
  await caja.crearUsuario(CAJERO, "Cajero del ensayo", "Cajero", "cajero");
  await caja.cliente.empujar();
  await esperar(700);
  comprobar(
    (await caja.almacen.eventos.pendientes(50)).length === 0,
    "el local se estrena: el propietario se declara y da de alta al mesero",
    `${Number((await salud()).seq)} eventos en el Hub`,
  );

  // La segunda terminal NO entra sola: tiene que firmarla una ya autorizada. Es
  // la diferencia entre un local cerrado y uno donde cualquier teléfono entra.
  // Solo se puede comprobar si el móvil llega por la red: por loopback el Hub lo
  // toma por la propia caja y lo autoriza, que es lo correcto y no un fallo.
  await movil.cliente.conectar();
  await esperar(700);
  if (lan) {
    comprobar(
      movil.cliente.estado === "isla",
      "la SEGUNDA terminal queda fuera hasta que alguien la apruebe",
      movil.cliente.estado,
    );
  } else {
    console.log("  n/a   la SEGUNDA terminal queda fuera — sin red que simular");
  }

  caja.cliente.autorizarTerminal(movil.deviceId);
  await esperar(500);
  movil.cliente.desconectar();
  await esperar(200);
  await movil.cliente.conectar();
  await esperar(800);
  comprobar(movil.cliente.estado === "sincronizado", "aprobada, entra", movil.cliente.estado);

  /*
   * Desde AQUÍ se cuenta la secuencia del viernes.
   *
   * El alta del local —el propietario y el mesero— también consume secuencia, y
   * medir desde el arranque haría fallar el recuento final por dos eventos que
   * sí tenían que existir. Lo que este ensayo vigila es que ninguna VENTA se
   * duplique, así que la referencia se toma con el local ya montado.
   */
  const alEmpezarElServicio = Number((await salud()).seq);

  const idsCaja: string[] = [];
  for (let i = 1; i <= 5; i++) idsCaja.push(...(await caja.vender(`mesa-${i}`, 250 + i)));
  await caja.cliente.empujar();
  await esperar(800);

  comprobar(
    idsCaja.every((id) => movil.recibidos.includes(id)),
    "lo que cobra la caja le llega al móvil en vivo",
    `${movil.recibidos.length} eventos recibidos`,
  );

  // --- EL APAGÓN: al móvil se le cae el enlace y sigue vendiendo ------------------------
  console.log("\n--- se cae el enlace del móvil ---\n");
  movil.cliente.desconectar();
  await esperar(200);
  comprobar(movil.cliente.estado === "isla", "el móvil queda en modo isla", movil.cliente.estado);

  const idsIsla: string[] = [];
  for (let i = 6; i <= 10; i++) idsIsla.push(...(await movil.vender(`mesa-${i}`, 300 + i)));
  const pendientes = await movil.almacen.eventos.pendientes(500);
  comprobar(
    pendientes.length === idsIsla.length,
    "lo vendido sin enlace queda a salvo en el outbox",
    `${pendientes.length} eventos esperando`,
  );

  // La caja sigue vendiendo mientras tanto: al reconectar hay que fusionar.
  const idsMientras: string[] = [];
  for (let i = 11; i <= 13; i++) idsMientras.push(...(await caja.vender(`mesa-${i}`, 400 + i)));
  await caja.cliente.empujar();
  await esperar(500);

  // --- Reconecta -----------------------------------------------------------------------
  console.log("--- vuelve el enlace ---\n");
  await movil.cliente.conectar();
  await esperar(800);
  await movil.cliente.empujar();
  await esperar(1000);

  comprobar(movil.cliente.estado === "sincronizado", "el móvil vuelve a enlazar");
  comprobar(
    (await movil.almacen.eventos.pendientes(500)).length === 0,
    "el outbox se vacía: el Hub confirmó todo lo de la isla",
  );
  comprobar(
    idsMientras.every((id) => movil.recibidos.includes(id)),
    "el móvil recibe lo que la caja vendió mientras estuvo desconectado",
  );

  // --- LO QUE IMPORTA: nada duplicado --------------------------------------------------
  await esperar(600);
  const enCaja = await caja.almacen.eventos.leerTodos();
  const enMovil = await movil.almacen.eventos.leerTodos();

  const idsUnicosCaja = new Set(enCaja.map((e) => e.id));
  const idsUnicosMovil = new Set(enMovil.map((e) => e.id));
  comprobar(idsUnicosCaja.size === enCaja.length, "la caja no tiene un solo evento repetido");
  comprobar(idsUnicosMovil.size === enMovil.length, "el móvil no tiene un solo evento repetido");

  const todos = [...idsCaja, ...idsIsla, ...idsMientras];
  const enElHub = todos.filter((id) => idsUnicosCaja.has(id) || idsUnicosMovil.has(id));
  comprobar(
    enElHub.length === todos.length,
    "no se perdió ninguna venta del viernes",
    `${enElHub.length}/${todos.length}`,
  );

  // Reenviar lo mismo NO puede duplicar: es la garantía del Hub.
  await caja.almacen.eventos.reabrirOutbox();
  await caja.cliente.empujar();
  await esperar(800);

  const despues = await salud();
  const crecimiento = Number(despues.seq) - alEmpezarElServicio;
  comprobar(
    crecimiento === todos.length,
    "el Hub asignó una secuencia por evento, ni una de más",
    `seq +${crecimiento}, eventos ${todos.length}`,
  );

  const registro = despues.registro as { nivel: string; eventos: number };
  comprobar(registro.nivel === "sano", "el registro del Hub sigue sano", registro.nivel);
  comprobar(
    typeof (despues.respaldo as { ultimo?: number })?.ultimo === "number",
    "hay respaldo verificado del registro",
  );

  caja.cliente.desconectar();
  movil.cliente.desconectar();
  await esperar(300);

  proceso.kill();
  await esperar(500);
  rmSync(carpeta, { recursive: true, force: true });

  console.log(`\n=== ${fallos === 0 ? "ENSAYO SUPERADO" : `${fallos} FALLA(S)`} ===\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((causa) => {
  console.error("\nEl ensayo no pudo correr:", causa);
  console.error("¿Está encendido el Hub? Comprueba http://localhost:8788/salud\n");
  process.exit(2);
});
