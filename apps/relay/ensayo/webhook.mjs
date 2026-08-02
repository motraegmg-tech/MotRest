import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La raiz del paquete del relay: el ensayo corre desde donde sea. */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const SECRET = "app-secret-de-prueba";
const VERIFY = "token-de-verificacion";
const CLAVE = "clave-del-hub";
const PUERTO = 8099;
const BASE = `http://localhost:${PUERTO}`;
let fallos = 0;

const ok = (b, q, d = "") => { console.log(`${b ? "  ok  " : " FALLA"}  ${q}${d ? `  — ${d}` : ""}`); if (!b) fallos++; };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/main.ts"], {
  cwd: RAIZ,
  env: { ...process.env,
    MOTREST_META_APP_SECRET: SECRET, MOTREST_META_VERIFY_TOKEN: VERIFY,
    MOTREST_RELAY_CLAVE_HUB: CLAVE, MOTREST_RELAY_PUERTO: String(PUERTO),
    MOTREST_RELAY_PADRON: "./datos-ensayo/restaurantes.json" },
  stdio: "inherit",
});

for (let i = 0; i < 40; i++) { await esperar(250); try { await fetch(`${BASE}/salud`); break; } catch {} }

console.log("\n=== ENSAYO DEL RELAY ===\n");

// 1. Meta verifica el webhook.
const reto = await fetch(`${BASE}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
ok(await reto.text() === "12345", "Meta verifica el webhook con el token correcto");

const malo = await fetch(`${BASE}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=equivocado&hub.challenge=1`);
ok(malo.status === 403, "un token equivocado no verifica nada", `HTTP ${malo.status}`);

// 2. El Hub del restaurante se conecta hacia afuera.
const { WebSocket } = await import("ws");
const hub = new WebSocket(`ws://localhost:${PUERTO}/hub`);
const recibidos = [];
await new Promise((r) => hub.on("open", r));
hub.on("message", (m) => recibidos.push(JSON.parse(String(m))));

hub.send(JSON.stringify({ tipo: "hola", clave: CLAVE, sucursal_id: "suc-rodizio" }));
await esperar(300);
ok(recibidos.some((m) => m.tipo === "bienvenida"), "el Hub de Rodizio se conecta hacia afuera");

hub.send(JSON.stringify({ tipo: "credenciales", phone_number_id: "111222333", token: "tok", nombre: "Rodizio" }));
await esperar(300);
const salud = await (await fetch(`${BASE}/salud`)).json();
ok(salud.restaurantes === 1 && salud.hubs_conectados === 1, "queda en el padron y con enlace vivo", JSON.stringify(salud));

// 3. Llega un mensaje de un comensal, firmado por Meta.
const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: {
  metadata: { phone_number_id: "111222333" },
  messages: [{ from: "5213311223344", id: "wamid.abc", timestamp: "1785000000", text: { body: "quiero reservar" } }],
} }] }] });
const firma = "sha256=" + createHmac("sha256", SECRET).update(cuerpo).digest("hex");

const r1 = await fetch(`${BASE}/webhook/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": firma }, body: cuerpo });
await esperar(400);
ok(r1.status === 200, "acepta el webhook firmado");
const entrante = recibidos.find((m) => m.tipo === "mensaje_entrante");
ok(!!entrante, "el mensaje llega al Hub del restaurante correcto");
ok(entrante?.mensaje?.texto === "quiero reservar", "con su texto intacto", entrante?.mensaje?.texto);

// 4. Meta reintenta: no debe procesarse dos veces.
const antes = recibidos.filter((m) => m.tipo === "mensaje_entrante").length;
await fetch(`${BASE}/webhook/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": firma }, body: cuerpo });
await esperar(400);
ok(recibidos.filter((m) => m.tipo === "mensaje_entrante").length === antes, "un reintento de Meta NO se procesa dos veces");

// 5. La puerta de la calle.
const sinFirma = await fetch(`${BASE}/webhook/whatsapp`, { method: "POST", headers: { "content-type": "application/json" }, body: cuerpo });
ok(sinFirma.status === 401, "un webhook sin firma se rechaza", `HTTP ${sinFirma.status}`);

const firmaFalsa = await fetch(`${BASE}/webhook/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) }, body: cuerpo });
ok(firmaFalsa.status === 401, "una firma inventada se rechaza", `HTTP ${firmaFalsa.status}`);

// 6. Un Hub que no sabe la clave no entra.
const intruso = new WebSocket(`ws://localhost:${PUERTO}/hub`);
await new Promise((r) => intruso.on("open", r));
let cerrado = false;
intruso.on("close", () => (cerrado = true));
intruso.send(JSON.stringify({ tipo: "hola", clave: "equivocada", sucursal_id: "suc-pirata" }));
await esperar(500);
ok(cerrado, "un Hub sin la clave del relay queda fuera");

hub.close();
relay.kill();
await esperar(300);
console.log(`\n=== ${fallos === 0 ? "ENSAYO SUPERADO" : `${fallos} FALLA(S)`} ===\n`);
process.exit(fallos === 0 ? 0 : 1);
