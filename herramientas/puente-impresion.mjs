/**
 * Puente 9100 → USB: hace pasar una impresora USB por una impresora de red.
 *
 * POR QUÉ EXISTE
 *
 * El Hub sabe imprimir por red desde siempre: abre un socket al puerto 9100 y
 * escribe los bytes. El transporte USB, en cambio, es nuevo y vive DENTRO del
 * ejecutable del Hub, así que para estrenarlo hay que reemplazar el binario —y
 * eso obliga a detenerlo, tirando las terminales y la sincronización de un
 * restaurante que está vendiendo.
 *
 * Este puente evita esa parada. Escucha en `127.0.0.1:9100`, que la lista
 * blanca del Hub ya considera un destino legítimo (el loopback está entre las
 * IPs privadas permitidas), recibe los bytes ESC/POS que el Hub le manda como
 * si fuera una impresora de red, y los entrega al spooler de Windows para que
 * salgan por el cable USB.
 *
 * Para el Hub es una impresora de red más. No hace falta actualizarlo, ni
 * reiniciarlo, ni tocar el POS: basta configurar la impresora con dirección
 * `127.0.0.1` y puerto `9100`.
 *
 * Cuando el Hub se actualice con el transporte USB nativo, este puente sobra:
 * se cambia la impresora a conexión USB y se apaga.
 *
 *   node herramientas/puente-impresion.mjs "BIXOLON SRP-350plus"
 *   node herramientas/puente-impresion.mjs "BIXOLON SRP-350plus" --puerto 9100
 */
import { createServer } from "node:net";
import { enviarRaw, listarImpresoras } from "./lib/spooler-raw.mjs";

const args = process.argv.slice(2);
const impresora = args.find((a) => !a.startsWith("--"));
const iPuerto = args.indexOf("--puerto");
const PUERTO = iPuerto >= 0 ? Number(args[iPuerto + 1]) : 9100;

/**
 * Solo loopback, nunca `0.0.0.0`.
 *
 * Escuchando en todas las interfaces, cualquiera en la wifi del local podría
 * mandar bytes crudos a la impresora de la caja y sacar tickets a voluntad.
 */
const HOST = "127.0.0.1";

if (!impresora) {
  console.error("Falta el nombre de la impresora.\n");
  console.error("Impresoras instaladas en este equipo:");
  for (const i of await listarImpresoras()) {
    console.error(`  · ${i.nombre}   [${i.puerto}]  ${i.estado}`);
  }
  console.error('\n  node herramientas/puente-impresion.mjs "<nombre exacto>"');
  process.exit(1);
}

const instaladas = await listarImpresoras();
if (!instaladas.some((i) => i.nombre === impresora)) {
  console.error(`No hay ninguna impresora llamada «${impresora}» en este equipo.`);
  console.error("Instaladas:");
  for (const i of instaladas) console.error(`  · ${i.nombre}`);
  process.exit(1);
}

const marca = () => new Date().toLocaleTimeString("es-MX");
let trabajos = 0;

const servidor = createServer((socket) => {
  const trozos = [];
  socket.on("data", (t) => trozos.push(t));
  socket.on("error", (e) => console.error(`${marca()}  conexión cortada: ${e.message}`));

  /*
   * Se imprime al CERRAR, no a cada trozo: el Hub escribe el ticket completo y
   * después cierra, y un ticket puede llegar partido en varios paquetes.
   * Imprimir por trozo sacaría el mismo ticket en pedazos sueltos.
   */
  socket.on("end", async () => {
    const datos = Buffer.concat(trozos);
    if (datos.length === 0) return;

    const n = ++trabajos;
    const r = await enviarRaw(impresora, datos, `MotRest · puente #${n}`);
    console.log(
      r.ok
        ? `${marca()}  #${n}  ${datos.length} bytes → ${impresora}  ✓`
        : `${marca()}  #${n}  ${datos.length} bytes → ERROR: ${r.error}`,
    );
  });
});

servidor.on("error", (causa) => {
  if (causa.code === "EADDRINUSE") {
    console.error(`El puerto ${PUERTO} ya está ocupado en ${HOST}.`);
    console.error("¿Hay otro puente corriendo? Ciérralo antes de abrir este.");
  } else {
    console.error(`No se pudo abrir el puente: ${causa.message}`);
  }
  process.exit(1);
});

servidor.listen(PUERTO, HOST, () => {
  console.log(`Puente de impresión activo en ${HOST}:${PUERTO}`);
  console.log(`   → ${impresora}`);
  console.log("");
  console.log("En MotRest, configura la impresora así:");
  console.log("   Conexión: Red (9100)");
  console.log(`   Dirección: ${HOST}`);
  console.log(`   Puerto: ${PUERTO}`);
  console.log("");
  console.log("Ctrl+C para cerrar.");
});

for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    console.log(`\nPuente cerrado tras ${trabajos} trabajo(s).`);
    servidor.close(() => process.exit(0));
  });
}
