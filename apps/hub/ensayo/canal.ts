/**
 * ENSAYO DEL CANAL DE ACTUALIZACIONES, contra la nube de verdad.
 *
 * Comprueba, con la clase `Actualizaciones` tal cual la usa el Hub, que un local
 * **encuentra la versión que le toca, la verifica y la descarga íntegra** — y
 * que a otro local no le llega. Si además se le da la llave de servicio,
 * publica antes la versión como lo haría Central.
 *
 * SE PARA ANTES DE INSTALAR, a propósito. `instalar()` lanza el instalador de
 * verdad y reemplaza el MotRest de esta máquina; eso es una decisión de quien
 * corre el ensayo, no del ensayo. Queda comprobada toda la cadena hasta el
 * byte: manifiesto → firma Ed25519 → reparto → descarga → SHA-256.
 *
 * SE FIRMA CON UNA LLAVE DE ENSAYO, nunca con la de MOTRAE. El Hub empaquetado
 * para esto tiene que llevar la pública correspondiente:
 *
 *     $env:MOTREST_ACTUALIZACIONES_PUBLICA = "<la pública de ensayo>"
 *     corepack pnpm@9.15.0 --filter @motrest/escritorio build
 *
 * CÓMO SE CORRE
 *
 *     # imprescindibles — solo verifica lo que ya esté publicado
 *     $env:MOTREST_NUBE_URL="https://<ref>.supabase.co"
 *     $env:MOTREST_NUBE_PUBLICABLE="sb_publishable_…"
 *     $env:MOTREST_ENSAYO_PUBLICA="<la pública de ensayo>"
 *     $env:MOTREST_ENSAYO_CREDENCIAL="…"
 *
 *     # opcionales — con esto, además publica
 *     $env:MOTREST_NUBE_SERVICIO="…"
 *     $env:MOTREST_ENSAYO_PRIVADA="<la privada de ensayo>"
 *     $env:MOTREST_ENSAYO_INSTALADOR="C:\…\MotRest_1.3.6_x64-setup.exe"
 *
 *     corepack pnpm@9.15.0 --filter @motrest/hub ensayo:canal
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { firmarVersion, type VersionDisponible } from "@motrest/dominio";
import { Actualizaciones } from "../src/actualizaciones.js";

const URL_NUBE = (process.env.MOTREST_NUBE_URL ?? "").replace(/[/]+$/, "");
const PUBLICABLE = process.env.MOTREST_NUBE_PUBLICABLE ?? "";
const SERVICIO = process.env.MOTREST_NUBE_SERVICIO ?? "";
const PRIVADA = process.env.MOTREST_ENSAYO_PRIVADA ?? "";
const PUBLICA = process.env.MOTREST_ENSAYO_PUBLICA ?? "";
const INSTALADOR = process.env.MOTREST_ENSAYO_INSTALADOR ?? "";
const CREDENCIAL = process.env.MOTREST_ENSAYO_CREDENCIAL ?? "";
const CREDENCIAL_VECINA = process.env.MOTREST_ENSAYO_CREDENCIAL_VECINA ?? "";

const YO = "suc-ensayo01";
const VECINO = "suc-ensayo02";
/** La que se supone instalada. El manifiesto tiene que ser posterior. */
const INSTALADA = process.env.MOTREST_ENSAYO_INSTALADA ?? "1.3.5";

/**
 * Publicar es opcional; verificar no.
 *
 * Sin la llave de servicio no se sube ni se firma nada: se comprueba lo que ya
 * esté publicado, que es la mitad que de verdad importa. Así el ensayo lo puede
 * correr quien no tenga esa llave — que es la que abre el padrón entero de
 * MOTRAE y no debería andar suelta por conveniencia.
 */
const PUBLICA_TAMBIEN = Boolean(SERVICIO && PRIVADA && INSTALADOR);

const faltan = Object.entries({
  MOTREST_NUBE_URL: URL_NUBE,
  MOTREST_NUBE_PUBLICABLE: PUBLICABLE,
  MOTREST_ENSAYO_PUBLICA: PUBLICA,
  MOTREST_ENSAYO_CREDENCIAL: CREDENCIAL,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (faltan.length > 0) {
  console.error(`Faltan: ${faltan.join(", ")}`);
  process.exit(1);
}

let fallos = 0;
const ok = (bien: boolean, que: string, detalle = ""): void => {
  if (!bien) fallos++;
  console.log(`${bien ? "  ok  " : " FALLA"}  ${que}${detalle ? `  — ${detalle}` : ""}`);
};

const servicio = {
  apikey: SERVICIO,
  authorization: `Bearer ${SERVICIO}`,
  "content-type": "application/json",
};

/** La huella del archivo, calculada como la calcula el Hub. */
async function sha256De(ruta: string): Promise<string> {
  return createHash("sha256").update(await readFile(ruta)).digest("hex");
}

/** Abre sesión como el Hub de un local y devuelve su cliente. */
async function comoLocal(sucursal: string, credencial: string) {
  const cliente = createClient(URL_NUBE, PUBLICABLE, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({
    email: `${sucursal}@hubs.motrae.mx`,
    password: credencial,
  });
  if (error) throw new Error(`${sucursal} no pudo entrar: ${error.message}`);
  return cliente;
}

/**
 * El canal de actualizaciones de un local, montado como lo monta el Hub.
 *
 * La consulta a `versiones` la hace el cliente ya autenticado y RLS decide qué
 * fila devuelve — por eso esto prueba el reparto de verdad, y no un manifiesto
 * escrito a mano en la prueba.
 */
function canalDe(
  cliente: Awaited<ReturnType<typeof comoLocal>>,
  sucursal: string,
  llave = PUBLICA,
  ruidoso = false,
): Actualizaciones {
  return new Actualizaciones(
    {
      repositorio: "motraegmg-tech/MotRest",
      llaveDeFirma: llave,
      nube: {
        host: new URL(URL_NUBE).host,
        manifiesto: async () => {
          const { data } = await cliente.from("versiones").select("manifiesto").maybeSingle();
          return data?.manifiesto ?? null;
        },
      },
    },
    INSTALADA,
    ruidoso ? (n, t) => console.log(`        [${n}] ${t}`) : () => undefined,
    fetch,
    {},
    () => undefined,
    sucursal,
  );
}

async function principal(): Promise<void> {
  console.log(`\nENSAYO DEL CANAL — ${URL_NUBE}\n`);

  let version = process.env.MOTREST_ENSAYO_VERSION ?? "";
  let huella = "";

  if (PUBLICA_TAMBIEN) {
    version = basename(INSTALADOR).match(/([0-9]+[.][0-9]+[.][0-9]+)/)?.[1] ?? "";
    if (!version) {
      console.error(`No se pudo sacar la versión del nombre: ${basename(INSTALADOR)}`);
      process.exit(1);
    }

    // --- 1 · Subir el instalador --------------------------------------------
    console.log(`1 · Publicar la ${version}`);

    const bytes = await readFile(INSTALADOR);
    huella = await sha256De(INSTALADOR);
    const tam = (await stat(INSTALADOR)).size;
    console.log(`        ${basename(INSTALADOR)} — ${(tam / 1024 / 1024).toFixed(1)} MB`);

    const subida = await fetch(`${URL_NUBE}/storage/v1/object/instaladores/${version}.exe`, {
      method: "POST",
      headers: {
        apikey: SERVICIO,
        authorization: `Bearer ${SERVICIO}`,
        "content-type": "application/octet-stream",
        "x-upsert": "true",
      },
      body: bytes,
    });
    ok(subida.ok, "el instalador está en Storage", subida.ok ? "" : await subida.text());

    // --- 2 · Firmar y publicar ----------------------------------------------
    const manifiesto: VersionDisponible = await firmarVersion(
      {
        version,
        notas: "Ensayo del canal: la misma caja, con el número subido.",
        url: `${URL_NUBE}/storage/v1/object/instaladores/${version}.exe`,
        sha256: huella,
        publicado_ts: Date.now(),
      },
      PRIVADA,
    );

    const alta = await fetch(`${URL_NUBE}/rest/v1/versiones`, {
      method: "POST",
      headers: { ...servicio, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        version: manifiesto.version,
        notas: manifiesto.notas,
        url: manifiesto.url,
        sha256: manifiesto.sha256,
        publicado_ts: new Date(manifiesto.publicado_ts).toISOString(),
        firma: manifiesto.firma,
        canal: "beta",
        manifiesto,
      }),
    });
    ok(alta.ok, "la versión está en el catálogo", alta.ok ? "" : await alta.text());

    /*
     * Solo a UN local, y en beta. Es lo que compra la tabla `asignaciones`: se
     * ensaya sobre un canario sin exponer a la flota, y por nombre en vez de por
     * un porcentaje que nadie puede leer.
     */
    const asigna = await fetch(`${URL_NUBE}/rest/v1/asignaciones`, {
      method: "POST",
      headers: { ...servicio, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([
        { sucursal_id: YO, canal: "beta", version_fijada: manifiesto.version },
      ]),
    });
    ok(asigna.ok, "se le asigna solo al canario", asigna.ok ? "" : await asigna.text());
  } else {
    console.log("Sin llave de servicio: no se publica nada, solo se verifica.");
  }

  // --- 3 · El local la encuentra ---------------------------------------------
  console.log("\n2 · Lo que ve el local al que le toca");

  const yo = await comoLocal(YO, CREDENCIAL);
  const encontrada = await canalDe(yo, YO, PUBLICA, true).buscar();

  ok(Boolean(encontrada), "encuentra una versión nueva", encontrada?.version ?? "ninguna");
  if (version) {
    ok(encontrada?.version === version, `y es la ${version}`, encontrada?.version ?? "ninguna");
  }
  if (huella) {
    ok(encontrada?.sha256 === huella, "con la huella del archivo que se subió");
  }

  // --- 4 · Al vecino no le llega ---------------------------------------------
  if (CREDENCIAL_VECINA) {
    const vecino = await comoLocal(VECINO, CREDENCIAL_VECINA);
    const suya = await canalDe(vecino, VECINO).buscar();
    /*
     * ESTO ES LO QUE EL MANIFIESTO PÚBLICO NO PODÍA DAR. Con el anillo, el
     * archivo estaba a la vista de todos y cada Hub se aplicaba el porcentaje a
     * sí mismo por honradez. Aquí el vecino no ve la fila siquiera.
     */
    ok(suya === null, "al vecino NO se le ofrece", suya?.version ?? "ninguna");
    await vecino.auth.signOut();
  }

  // --- 5 · La firma es la autoridad ------------------------------------------
  console.log("\n3 · La firma manda, no la nube");

  const ajena = `MCowBQYDK2VwAyEA${"A".repeat(43)}=`;
  const conFirmaAjena = await canalDe(yo, YO, ajena).buscar();
  ok(conFirmaAjena === null, "un manifiesto sin la firma de MOTRAE se ignora");

  // --- 6 · Descargar de verdad -----------------------------------------------
  console.log("\n4 · La descarga");

  if (encontrada) {
    try {
      const ruta = await canalDe(yo, YO, PUBLICA, true).descargar(encontrada);
      const bajado = await sha256De(ruta);
      /*
       * descargar() ya comprueba el SHA-256 y revienta si no cuadra. Se vuelve a
       * calcular aquí sobre el archivo en disco porque lo que interesa demostrar
       * no es que la comprobación exista, sino que lo que quedó escrito es de
       * verdad lo que se publicó.
       */
      ok(bajado === encontrada.sha256, "lo descargado coincide byte a byte con el manifiesto");
      console.log(`        ${ruta}`);
    } catch (causa) {
      ok(false, "la descarga se completa", String(causa));
    }
  }

  await yo.auth.signOut();

  console.log(
    `\n${fallos === 0 ? "TODO EN PIE" : `${fallos} FALLA(S)`}` +
      "\nNo se instaló nada: instalar reemplaza el MotRest de esta máquina y esa" +
      "\ndecisión no es del ensayo.\n",
  );
  process.exit(fallos === 0 ? 0 : 1);
}

void principal().catch((causa) => {
  console.error(`\nEl ensayo se rompió: ${String(causa)}`);
  process.exit(1);
});
