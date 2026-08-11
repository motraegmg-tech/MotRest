/**
 * Prueba una impresora de tickets sin levantar MotRest entero.
 *
 * Sirve para separar dos preguntas que en un local se confunden todo el tiempo:
 * «¿está mal el POS?» y «¿está mal la impresora?». Esto habla directo con el
 * papel, así que si aquí sale el ticket, la impresora está bien.
 *
 *   node herramientas/probar-impresora.mjs                        (lista las instaladas)
 *   node herramientas/probar-impresora.mjs "BIXOLON SRP-350plus"  (imprime por USB)
 *   node herramientas/probar-impresora.mjs 192.168.100.50         (imprime por red)
 */
import { Socket } from "node:net";
import { enviarRaw, listarImpresoras } from "./lib/spooler-raw.mjs";

const destino = process.argv[2];

/** Un ticket ESC/POS mínimo: inicializa, centra, escribe, avanza y corta. */
function ticketDePrueba() {
  const texto =
    "MOTRAE\n" +
    "MotRest\n\n" +
    "Prueba de impresion\n" +
    "Acentos: ninos, pina, cafe\n" +
    `${new Date().toLocaleString("es-MX")}\n`;

  return Uint8Array.from([
    0x1b, 0x40,                                    // inicializar
    0x1b, 0x61, 0x01,                              // centrar
    // Solo ASCII: si algo sale mal, que no sea por la tabla de caracteres.
    ...[...texto].map((c) => c.charCodeAt(0) & 0x7f),
    0x0a, 0x0a, 0x0a,                              // avanzar para poder cortar
    0x1d, 0x56, 0x00,                              // cortar
  ]);
}

/** Envía por socket al 9100, que es el estándar de impresión directa. */
function imprimirPorRed(host, puerto, datos) {
  return new Promise((resolver) => {
    const socket = new Socket();
    let resuelto = false;
    const fin = (r) => { if (!resuelto) { resuelto = true; socket.destroy(); resolver(r); } };

    socket.setTimeout(5000);
    socket.on("timeout", () => fin({ ok: false, error: "no respondió a tiempo" }));
    socket.on("error", (e) => fin({ ok: false, error: e.message }));
    socket.on("close", (conError) => { if (!conError) fin({ ok: true }); });
    socket.connect(puerto, host, () => socket.write(Buffer.from(datos), () => socket.end()));
  });
}

// --- Programa ------------------------------------------------------------------------

if (!destino) {
  console.log("Impresoras instaladas en Windows:\n");
  const lista = await listarImpresoras();
  if (lista.length === 0) {
    console.log("  (ninguna)");
  } else {
    for (const i of lista) console.log(`  · ${i.nombre}   [${i.puerto}]  ${i.estado}`);
  }
  console.log(
    "\nSi tu impresora de tickets NO aparece aquí, MotRest tampoco puede verla:\n" +
    "instálala primero en Windows (Configuración › Bluetooth y dispositivos › Impresoras).\n" +
    "\nDespués:  node herramientas/probar-impresora.mjs \"<nombre exacto>\"",
  );
  process.exit(0);
}

const datos = ticketDePrueba();
const esIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(destino);

let resultado;
if (esIp) {
  const [host, puerto = "9100"] = destino.split(":");
  console.log(`Enviando ${datos.length} bytes por red a ${host}:${puerto}…`);
  resultado = await imprimirPorRed(host, Number(puerto), datos);
} else {
  console.log(`Enviando ${datos.length} bytes por USB a «${destino}»…`);
  resultado = await enviarRaw(destino, datos, "MotRest prueba");
}

if (resultado.ok) {
  console.log("\n✓ El trabajo salió. Si NO ves el ticket en papel, revisa:");
  console.log("  · que haya rollo y la tapa esté cerrada");
  console.log("  · que la impresora entienda ESC/POS (casi todas las térmicas)");
} else {
  console.log(`\n✗ No se pudo imprimir: ${resultado.error}`);
  console.log("\nEjecuta el comando sin argumentos para ver los nombres exactos.");
  process.exit(1);
}
