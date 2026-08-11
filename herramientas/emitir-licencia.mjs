/**
 * Emite una licencia firmada como lo haría MotRest Central, para poder probar el
 * alta de un restaurante de punta a punta contra el Hub empaquetado.
 *
 * Uso: node emitir-licencia.mjs <privada-base64> <sucursal_id> <nombre>
 */
const [, , PRIVADA, SUCURSAL, NOMBRE] = process.argv;

const deB64 = (t) => Uint8Array.from(Buffer.from(t, "base64"));
const aB64 = (b) => Buffer.from(b).toString("base64");

/**
 * El mismo serializado canónico que usa el dominio: claves ordenadas en todos
 * los niveles. Si esto no coincide byte a byte, la firma no verifica.
 */
function canonico(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  const claves = Object.keys(valor)
    .filter((k) => valor[k] !== undefined)
    .sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(",")}}`;
}

const datos = {
  sucursal_id: SUCURSAL,
  nombre: NOMBRE,
  plan: "mensual",
  vence_ts: Date.now() + 30 * 86_400_000,
  gracia_dias: 3,
  emitida_ts: Date.now(),
};

const llave = await crypto.subtle.importKey("pkcs8", deB64(PRIVADA), "Ed25519", false, ["sign"]);
const firma = await crypto.subtle.sign("Ed25519", llave, new TextEncoder().encode(canonico(datos)));

// La firma viaja en HEXADECIMAL, no en base64: así la lee `verificar`.
const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
console.log(JSON.stringify({ ...datos, firma: hex }));
