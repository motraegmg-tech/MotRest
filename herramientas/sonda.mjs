/**
 * Sonda: abre el POS servido por el Hub local en Chrome headless y reporta
 * qué ve el navegador — errores de consola, el marcador inyectado y el estado
 * del enlace.
 */
const DESTINO = process.argv[2] ?? "http://localhost:9788/";
const CDP = "http://127.0.0.1:9222";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const objetivos = await (await fetch(`${CDP}/json/list`)).json();
let pagina = objetivos.find((o) => o.type === "page");
if (!pagina) {
  pagina = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
}

const ws = new WebSocket(pagina.webSocketDebuggerUrl);
let id = 0;
const pendientes = new Map();
const consola = [];
const fallosRed = [];

function llamar(method, params = {}) {
  const mensaje = { id: ++id, method, params };
  return new Promise((res) => {
    pendientes.set(mensaje.id, res);
    ws.send(JSON.stringify(mensaje));
  });
}

await new Promise((r) => (ws.onopen = r));

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    pendientes.get(m.id)(m.result);
    pendientes.delete(m.id);
    return;
  }
  if (m.method === "Runtime.consoleAPICalled") {
    consola.push(
      `[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    );
  }
  if (m.method === "Log.entryAdded") {
    consola.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  }
  if (m.method === "Runtime.exceptionThrown") {
    consola.push(`[excepcion] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ""}`);
  }
  if (m.method === "Network.loadingFailed") {
    fallosRed.push(`${m.params.type} ${m.params.errorText} ${m.params.blockedReason ?? ""}`);
  }
  if (m.method === "Network.webSocketFrameError") {
    fallosRed.push(`ws-error ${m.params.errorMessage}`);
  }
  if (m.method === "Network.webSocketCreated") {
    fallosRed.push(`ws-creado ${m.params.url}`);
  }
  if (m.method === "Network.webSocketHandshakeResponseReceived") {
    fallosRed.push(`ws-handshake ${m.params.response.status}`);
  }
  if (m.method === "Network.webSocketClosed") {
    fallosRed.push(`ws-cerrado`);
  }
  if (m.method === "Network.webSocketFrameSent") {
    fallosRed.push(`ws-> ${String(m.params.response.payloadData).slice(0, 120)}`);
  }
  if (m.method === "Network.webSocketFrameReceived") {
    fallosRed.push(`ws<- ${String(m.params.response.payloadData).slice(0, 120)}`);
  }
};

await llamar("Runtime.enable");
await llamar("Log.enable");
await llamar("Network.enable");
await llamar("Page.enable");
await llamar("Page.navigate", { url: DESTINO });
await sleep(9000);

const ev = async (expr) =>
  (await llamar("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))
    ?.result?.value;

console.log("=== marcador inyectado ===");
console.log(await ev("JSON.stringify(window.__MOTREST_HUB__ ?? null)"));
console.log("=== texto visible (primeros 900) ===");
console.log(await ev("document.body.innerText.slice(0,900)"));
console.log("=== chips del encabezado ===");
console.log(await ev("JSON.stringify([...document.querySelectorAll('.chip')].map(e=>e.innerText))"));
console.log("=== consola ===");
console.log(consola.join("\n") || "(vacía)");
console.log("=== red ===");
console.log(fallosRed.join("\n") || "(sin incidencias)");

ws.close();
process.exit(0);
