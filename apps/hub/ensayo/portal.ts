/**
 * ENSAYO DEL PORTAL DEL COMENSAL, contra un Hub de verdad.
 *
 * Levanta el Hub sobre un local limpio, cobra una cuenta como lo haría la caja,
 * arma el enlace firmado igual que lo hace una terminal, y luego entra por la
 * puerta del comensal — que es la única del sistema abierta a un teléfono ajeno.
 *
 * Lo que se comprueba no es que funcione: es que NO se pueda forzar.
 *
 *     corepack pnpm@9.15.0 --filter @motrest/hub ensayo:portal
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = 8791;
const BASE = `http://localhost:${PUERTO + 1}`;
const SUC = "suc-ensayo";

let fallos = 0;
const ok = (b, q, d = "") => {
  console.log(`${b ? "  ok  " : " FALLA"}  ${q}${d ? `  — ${d}` : ""}`);
  if (!b) fallos++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const carpeta = mkdtempSync(join(tmpdir(), "motrest-portal-"));

const hub = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/main.ts"], {
  cwd: RAIZ,
  env: {
    ...process.env,
    MOTREST_HUB_DB: join(carpeta, "hub.sqlite"),
    MOTREST_RESPALDOS: join(carpeta, "respaldos"),
    MOTREST_HUB_PUERTO: String(PUERTO),
    MOTREST_HUB_ID: "hub-ensayo-portal",
    MOTREST_SUCURSAL_ID: SUC,
  },
  stdio: "ignore",
});

for (let i = 0; i < 60; i++) {
  await esperar(250);
  try {
    await fetch(`${BASE}/salud`);
    break;
  } catch {
    /* todavía no */
  }
}

console.log("\n=== ENSAYO DEL PORTAL DEL COMENSAL ===\n");

// El Hub inyecta su url y su clave del local en el índice que sirve localmente.
const html = await (await fetch(`${BASE}/`)).text();
const datos = JSON.parse(html.match(/window\.__MOTREST_HUB__\s*=\s*(\{.*?\});/s)[1]);

const { WebSocket } = await import("ws");
const { ClienteSync, almacenEnMemoria, derivarSecretoPortal } = await import(
  "@motrest/protocolo-sync"
);
const { FabricaEventos, pesos, codigoDeCuenta, uuidv7, snapshotTasas, IVA_16 } = await import(
  "@motrest/dominio"
);

// --- Una caja cobra una cuenta, como el viernes -------------------------------------------

const almacen = almacenEnMemoria();
const cliente = new ClienteSync({
  url: datos.url,
  clave: datos.clave,
  device_id: "dev-caja-ensayo",
  sucursal_id: SUC,
  almacen,
  crearSocket: (url) => new WebSocket(url),
});
await cliente.conectar();
await esperar(900);

const fabrica = new FabricaEventos({
  device_id: "dev-caja-ensayo",
  empleado_id: "usr-lucia",
  sucursal_id: SUC,
});
const orden = uuidv7();
const renglon = {
  id: uuidv7(),
  producto_id: "prod-pizza",
  descripcion: "Pizza mitad y mitad",
  cantidad: 1,
  precio_unitario: pesos(249),
  costo_unitario: pesos(62),
  impuesto: snapshotTasas(IVA_16),
  estado: "entregado",
};

await almacen.eventos.anexar([
  fabrica.crear("orden_creada", orden, { orden_id: orden, mesa_id: "mesa-5", abierta_ts: Date.now() }),
  fabrica.crear("item_agregado", orden, { orden_id: orden, renglon }),
  fabrica.crear("pago_registrado", orden, { orden_id: orden, monto: pesos(288.84), forma: "efectivo" }),
  fabrica.crear("cuenta_cerrada", orden, { orden_id: orden }),
]);
await cliente.empujar();
await esperar(900);

// --- La terminal arma el enlace, sin preguntarle al Hub ------------------------------------

const secreto = await derivarSecretoPortal(datos.clave);
const codigo = await codigoDeCuenta(orden, secreto);
ok(!!codigo && codigo.includes("~"), "la terminal firma el enlace con su propia clave");

// --- El comensal entra --------------------------------------------------------------------

const cuenta = await fetch(`${BASE}/portal/api/cuenta/${encodeURIComponent(codigo)}`);
ok(cuenta.ok, "el enlace del ticket abre su cuenta", `HTTP ${cuenta.status}`);

const suCuenta = await cuenta.json();
ok(
  suCuenta.renglones?.[0]?.descripcion === "Pizza mitad y mitad",
  "ve lo que consumió",
  suCuenta.renglones?.[0]?.descripcion,
);
ok(!JSON.stringify(suCuenta).includes("62"), "NO ve el costo del platillo");
ok(!JSON.stringify(suCuenta).includes("usr-lucia"), "NO ve quién lo atendió");

// --- La puerta ----------------------------------------------------------------------------

const inventado = await fetch(`${BASE}/portal/api/cuenta/${orden}~AAAAAAAAAAAAAAAA`);
ok(inventado.status === 404, "un código inventado no abre nada", `HTTP ${inventado.status}`);

const otraOrden = uuidv7();
const firmaAjena = codigo.split("~")[1];
const cruzado = await fetch(`${BASE}/portal/api/cuenta/${otraOrden}~${firmaAjena}`);
ok(cruzado.status === 404, "la firma de una cuenta no abre otra", `HTTP ${cruzado.status}`);

// --- Califica quien comió -------------------------------------------------------------------

const opinar = async (calificacion) =>
  fetch(`${BASE}/portal/api/opinion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codigo, calificacion, motivos: ["espera"], comentario: "Tardó" }),
  });

ok((await opinar("mal")).ok, "el comensal califica su visita");
ok((await opinar("bien")).status === 409, "no puede calificar dos veces la misma cuenta");

await esperar(600);
const yaOpino = await (await fetch(`${BASE}/portal/api/cuenta/${encodeURIComponent(codigo)}`)).json();
ok(yaOpino.ya_opino === true, "al volver, el portal ya no le pregunta");

// --- Reservar ------------------------------------------------------------------------------

const manana = Date.now() + 86_400_000;
const reserva = await fetch(`${BASE}/portal/api/reserva`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nombre: "Familia Ramírez", telefono: "3311223344", personas: 4, para_ts: manana }),
});
ok(reserva.ok, "puede pedir mesa desde el teléfono");

const ayer = await fetch(`${BASE}/portal/api/reserva`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nombre: "Ramírez", personas: 2, para_ts: Date.now() - 86_400_000 }),
});
ok(!ayer.ok, "no puede reservar para ayer", `HTTP ${ayer.status}`);

// --- Lo que la caja recibe -----------------------------------------------------------------

await esperar(900);
const todos = await almacen.eventos.leerTodos();
const opinion = todos.find((e) => e.tipo === "opinion_registrada");
ok(!!opinion, "la opinión llega sola a la caja");
ok(opinion?.empleado_id === "comensal", "y queda a nombre del COMENSAL, no del mesero", opinion?.empleado_id);

const solicitud = todos.find((e) => e.tipo === "reserva_creada");
ok(!!solicitud, "la solicitud de reserva llega a la caja");
ok(solicitud?.origen === "comensal", "marcada como pedida por un comensal", solicitud?.origen);
ok(!solicitud?.mesa_id, "y SIN mesa apartada: la casa decide");

cliente.desconectar();
await esperar(300);
hub.kill();
await esperar(500);
rmSync(carpeta, { recursive: true, force: true });

console.log(`\n=== ${fallos === 0 ? "ENSAYO SUPERADO" : `${fallos} FALLA(S)`} ===\n`);
process.exit(fallos === 0 ? 0 : 1);
