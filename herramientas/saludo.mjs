/**
 * Habla con el Hub como lo haría la caja y descifra lo que responde.
 * Uso: node saludo.mjs <ws-url> <clave> <sucursal_id>
 */
const [, , URL_HUB, CLAVE, SUCURSAL] = process.argv;

const deB64Url = (t) =>
  Uint8Array.from(
    Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
const aB64Url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const material = await crypto.subtle.importKey("raw", deB64Url(CLAVE), "HKDF", false, ["deriveKey"]);
const derivar = (info) =>
  crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
const aHub = await derivar("motrest:sync:cliente->hub:v1");
const aCliente = await derivar("motrest:sync:hub->cliente:v1");

async function cifrar(clave, mensaje) {
  const n = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: n },
    clave,
    new TextEncoder().encode(JSON.stringify(mensaje)),
  );
  return JSON.stringify({ ec: 1, n: aB64Url(n), c: aB64Url(new Uint8Array(c)) });
}
async function descifrar(clave, crudo) {
  const s = JSON.parse(crudo);
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deB64Url(s.n) },
    clave,
    deB64Url(s.c),
  );
  return JSON.parse(new TextDecoder().decode(claro));
}

const ws = new WebSocket(URL_HUB);
ws.onopen = async () => {
  console.log("abierto; mando hola con sucursal_id =", SUCURSAL);
  ws.send(
    await cifrar(aHub, {
      tipo: "hola",
      v: 1,
      device_id: "dev-prueba-caja",
      sucursal_id: SUCURSAL,
      desde_seq: 0,
    }),
  );
};
ws.onmessage = async (e) => {
  console.log("EL HUB RESPONDE:", JSON.stringify(await descifrar(aCliente, e.data)));
};
ws.onclose = (e) => {
  console.log(`cerrado por el Hub (code=${e.code} reason="${e.reason}")`);
  process.exit(0);
};
setTimeout(() => process.exit(0), 6000);
