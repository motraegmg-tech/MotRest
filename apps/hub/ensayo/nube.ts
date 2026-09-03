/**
 * ENSAYO DE LA NUBE, contra el Supabase de verdad.
 *
 * Esto no es una prueba unitaria: usa la clase `EnlaceSupabase` tal cual la
 * usa el Hub, inicia sesión de verdad, abre Realtime de verdad y comprueba qué
 * llega y qué no. Las pruebas con dobles demuestran que el código hace lo que
 * dice; solo esto demuestra que **la nube hace lo que creemos**.
 *
 * Es la misma disciplina que el ensayo del viernes: nada se da por bueno porque
 * compile.
 *
 * QUÉ SE COMPRUEBA
 *
 *   1. La credencial correcta entra, y la equivocada NO.
 *   2. Un local ve su ficha y ninguna otra — con un JWT emitido por Supabase,
 *      no simulado con `set request.jwt.claims`.
 *   3. El pulso se escribe, el servidor le pisa la hora, y el inventario se
 *      sanea.
 *   4. Un local NO puede escribir el pulso de otro.
 *   5. Realtime entrega el mensaje entrante a su Hub, en segundos.
 *   6. La renovación llega y, al confirmarla, el buzón queda cerrado.
 *
 * CÓMO SE CORRE
 *
 *     $env:MOTREST_NUBE_URL="https://<ref>.supabase.co"
 *     $env:MOTREST_NUBE_PUBLICABLE="sb_publishable_…"
 *     $env:MOTREST_ENSAYO_CREDENCIAL="…"           # la del local de ensayo
 *     $env:MOTREST_ENSAYO_CREDENCIAL_VECINA="…"    # la del vecino
 *     corepack pnpm@9.15.0 --filter @motrest/hub ensayo:nube
 *
 * Los pasos 5 y 6 necesitan que alguien inserte la fila desde fuera (Meta y
 * Central, en la vida real). El guion espera e imprime qué hacer; si nadie lo
 * hace, esos dos renglones salen como PENDIENTE y no como FALLA — no haber
 * comprobado algo no es lo mismo que haberlo comprobado mal.
 */
import { createClient } from "@supabase/supabase-js";
import { EnlaceSupabase } from "../src/enlace-supabase.js";
import type { MensajeDelComensal } from "../src/enlace-motrae.js";

const URL_NUBE = process.env.MOTREST_NUBE_URL ?? "";
const PUBLICABLE = process.env.MOTREST_NUBE_PUBLICABLE ?? "";
const CREDENCIAL = process.env.MOTREST_ENSAYO_CREDENCIAL ?? "";
const CREDENCIAL_VECINA = process.env.MOTREST_ENSAYO_CREDENCIAL_VECINA ?? "";

const YO = "suc-ensayo01";
const VECINO = "suc-ensayo02";
/** Cuánto se espera a que Realtime entregue antes de darlo por pendiente. */
const ESPERA_MS = Number(process.env.MOTREST_ENSAYO_ESPERA_MS ?? 45_000);

if (!URL_NUBE || !PUBLICABLE || !CREDENCIAL) {
  console.error(
    "Faltan MOTREST_NUBE_URL, MOTREST_NUBE_PUBLICABLE y/o MOTREST_ENSAYO_CREDENCIAL.",
  );
  process.exit(1);
}

let fallos = 0;
let pendientes = 0;
const ok = (bien: boolean, que: string, detalle = ""): void => {
  if (!bien) fallos++;
  console.log(`${bien ? "  ok  " : " FALLA"}  ${que}${detalle ? `  — ${detalle}` : ""}`);
};
const pendiente = (que: string, detalle = ""): void => {
  pendientes++;
  console.log(` PEND.  ${que}${detalle ? `  — ${detalle}` : ""}`);
};

const callar = (): void => undefined;
const mensajes: MensajeDelComensal[] = [];
const licencias: unknown[] = [];

function enlace(sucursal: string, credencial: string, ruidoso = false): EnlaceSupabase {
  return new EnlaceSupabase({
    url: URL_NUBE,
    llavePublicable: PUBLICABLE,
    clave: credencial,
    sucursal_id: sucursal,
    registrar: ruidoso ? (n, t) => console.log(`        [${n}] ${t}`) : callar,
    alLlegarMensaje: (m) => {
      mensajes.push(m);
    },
    alLlegarLicencia: async (l) => {
      licencias.push(l);
      // Se acepta a propósito: lo que se está comprobando aquí es el CAMINO
      // —que llega y que confirmarla cierra el buzón—, no la verificación de la
      // firma, que ya tiene sus propias pruebas y no depende de la nube.
      return { ok: true };
    },
  });
}

/** Espera a que se cumpla algo, o se rinde. Devuelve si se cumplió. */
async function esperarA(condicion: () => boolean, ms: number): Promise<boolean> {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return condicion();
}

async function principal(): Promise<void> {
  console.log(`\nENSAYO DE LA NUBE — ${URL_NUBE}\n`);

  // --- 1 · Entrar ------------------------------------------------------------
  console.log("1 · La credencial");

  const mal = enlace(YO, "esta-credencial-no-es-de-nadie");
  mal.conectar();
  const entroConMala = await esperarA(() => mal.conectado(), 8_000);
  ok(!entroConMala, "una credencial equivocada NO entra");
  mal.desconectar();

  const yo = enlace(YO, CREDENCIAL, true);
  yo.conectar();
  const entre = await esperarA(() => yo.conectado(), 20_000);
  ok(entre, "la credencial del local entra");
  if (!entre) {
    console.error("\nSin enlace no se puede comprobar nada más.");
    process.exit(1);
  }

  /*
   * A partir de aquí se consulta con un cliente que lleva el MISMO JWT que sacó
   * el enlace. Es la diferencia con las pruebas de esquema: allí la sucursal se
   * simulaba con `set request.jwt.claims`; aquí la firmó Supabase Auth.
   */
  const comoYo = createClient(URL_NUBE, PUBLICABLE, { auth: { persistSession: false } });
  await comoYo.auth.signInWithPassword({
    email: `${YO}@hubs.motrae.mx`,
    password: CREDENCIAL,
  });

  // --- 2 · Qué ve ------------------------------------------------------------
  console.log("\n2 · Lo que un local puede ver");

  const { data: fichas } = await comoYo.from("sucursales").select("sucursal_id");
  ok(fichas?.length === 1, "ve exactamente una ficha", `vio ${fichas?.length ?? 0}`);
  ok(fichas?.[0]?.sucursal_id === YO, "y es la suya", fichas?.[0]?.sucursal_id ?? "ninguna");

  const { data: delVecino } = await comoYo
    .from("sucursales")
    .select("sucursal_id")
    .eq("sucursal_id", VECINO);
  ok(delVecino?.length === 0, "la ficha del vecino le da CERO filas, no un error");

  // --- 3 · El pulso ----------------------------------------------------------
  console.log("\n3 · El parte de vida");

  yo.reportarPulso({
    version: "9.9.9",
    // Un reloj en cualquier año: el servidor tiene que pisarlo.
    ts: new Date("2019-01-01").getTime(),
    terminales: 4,
    problemas: Array.from({ length: 25 }, (_, i) => `ruido ${i}`),
    dispositivos: [
      {
        device_id: "tablet-ensayo",
        nombre: "Salón 1",
        aprobado: true,
        visto_ts: 123,
        token: "ESTO-ES-LA-CREDENCIAL-DE-EMPAREJAMIENTO",
      },
    ],
  });

  // El pulso se manda sin esperar respuesta (es un upsert a fuego y olvido, como
  // en el relay), así que se le da un momento antes de ir a leerlo.
  await new Promise((r) => setTimeout(r, 3_000));
  const { data: pulso } = await comoYo.from("pulsos").select("*").maybeSingle();

  ok(Boolean(pulso), "el pulso se escribió");
  if (pulso) {
    const reciente = Date.now() - new Date(String(pulso.ts)).getTime() < 120_000;
    ok(reciente, "la hora la puso el servidor, no el local", String(pulso.ts));
    ok(
      Array.isArray(pulso.problemas) && pulso.problemas.length === 10,
      "los 25 problemas se recortaron a 10",
      `quedaron ${Array.isArray(pulso.problemas) ? pulso.problemas.length : "?"}`,
    );
    const terminal = (pulso.dispositivos as Record<string, unknown>[])?.[0] ?? {};
    ok(!("token" in terminal), "el token colado en el inventario NO sobrevivió");
    ok(terminal.device_id === "tablet-ensayo", "y la terminal legítima sí");
  }

  const { error: ajeno } = await comoYo
    .from("pulsos")
    .insert({ sucursal_id: VECINO, version: "9.9.9" });
  ok(Boolean(ajeno), "no puede reportar el pulso del vecino", ajeno?.code ?? "");

  // --- 4 · Realtime ----------------------------------------------------------
  console.log("\n4 · Lo que llega solo (Realtime)");
  console.log(`        Esperando hasta ${Math.round(ESPERA_MS / 1000)} s. Desde fuera, inserta:`);
  console.log(`        insert into public.mensajes_entrantes (sucursal_id, externo_id, contacto, texto)`);
  console.log(`          values ('${YO}', 'wamid.ensayo-'||gen_random_uuid(), '5215500000000', 'Hola, ¿tienen mesa?');`);
  console.log(`        insert into public.licencias_pendientes (sucursal_id, licencia)`);
  console.log(`          values ('${YO}', '{"sucursal_id":"${YO}","ensayo":true}'::jsonb);`);

  const llegoMensaje = await esperarA(() => mensajes.length > 0, ESPERA_MS);
  if (llegoMensaje) {
    ok(true, "el mensaje entrante llegó por Realtime", mensajes[0]!.texto);
    ok(mensajes[0]!.sucursal_id === YO, "y venía marcado para este local");

    const { data: fila } = await comoYo
      .from("mensajes_entrantes")
      .select("entregado_ts")
      .eq("externo_id", mensajes[0]!.externo_id)
      .maybeSingle();
    ok(Boolean(fila?.entregado_ts), "el Hub lo marcó como recogido");
  } else {
    pendiente("el mensaje entrante llega por Realtime", "nadie insertó la fila");
  }

  const llegoLicencia = await esperarA(() => licencias.length > 0, llegoMensaje ? 15_000 : 1);
  if (llegoLicencia) {
    ok(true, "la renovación llegó por Realtime");
    const { data: buzon } = await comoYo
      .from("licencias_pendientes")
      .select("confirmada_ts, ultimo_error")
      .maybeSingle();
    ok(Boolean(buzon?.confirmada_ts), "y al confirmarla el buzón quedó cerrado");
  } else {
    pendiente("la renovación llega por Realtime", "nadie insertó la fila");
  }

  // --- 5 · El vecino ---------------------------------------------------------
  if (CREDENCIAL_VECINA) {
    console.log("\n5 · Desde el otro lado");
    const comoVecino = createClient(URL_NUBE, PUBLICABLE, { auth: { persistSession: false } });
    const { error: entroVecino } = await comoVecino.auth.signInWithPassword({
      email: `${VECINO}@hubs.motrae.mx`,
      password: CREDENCIAL_VECINA,
    });
    ok(!entroVecino, "el vecino también entra con la suya");

    const { data: pulsosVecino } = await comoVecino.from("pulsos").select("sucursal_id");
    ok(pulsosVecino?.length === 0, "y NO ve el pulso que acaba de escribir el otro");

    /*
     * Lo que se comprueba NO es que el vecino no vea mensajes —puede tener los
     * suyos, y de hecho conviene que los tenga para que la prueba signifique
     * algo—, sino que **ninguno sea del otro local**. Preguntarle si ve cero
     * mensajes daba por bueno el caso trivial en el que no hay nada que ver.
     */
    const { data: mensajesVecino } = await comoVecino
      .from("mensajes_entrantes")
      .select("sucursal_id");
    ok(
      (mensajesVecino ?? []).every((m) => m.sucursal_id === VECINO),
      "de los mensajes que ve, ninguno es del otro local",
      `vio ${mensajesVecino?.length ?? 0}`,
    );

    const { data: ajenos } = await comoVecino
      .from("mensajes_entrantes")
      .select("id")
      .eq("sucursal_id", YO);
    ok(ajenos?.length === 0, "y pidiéndolos a propósito recibe CERO filas");
    await comoVecino.auth.signOut();
  } else {
    pendiente("el vecino no ve nada ajeno", "sin MOTREST_ENSAYO_CREDENCIAL_VECINA");
  }

  yo.desconectar();
  await comoYo.auth.signOut();

  console.log(
    `\n${fallos === 0 ? "TODO EN PIE" : `${fallos} FALLA(S)`}` +
      `${pendientes > 0 ? ` · ${pendientes} sin comprobar` : ""}\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

void principal().catch((causa) => {
  console.error(`\nEl ensayo se rompió: ${String(causa)}`);
  process.exit(1);
});
