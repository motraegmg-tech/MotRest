/**
 * Dar de alta un restaurante en la nube de MotRest.
 *
 * Sustituye a `padron alta` del relay (apps/relay/src/padron-cli.ts), y con él
 * desaparece lo más incómodo de aquel: **había que entrar por SSH a la máquina
 * del relay**, porque el padrón estaba cifrado con una llave que solo existía
 * en ese entorno. Ahora el alta se hace desde aquí.
 *
 * Lo que no cambia: un restaurante entra porque MOTRAE lo mete y sale porque
 * MOTRAE lo saca. Nada se da de alta solo.
 *
 * LA LLAVE DE SERVICIO NUNCA SE TECLEA EN EL COMANDO. Entra por variable de
 * entorno y no como argumento, porque los argumentos quedan en el historial del
 * shell y en la lista de procesos — y esta llave abre la cartera entera de
 * MOTRAE, saltándose todas las políticas RLS.
 *
 *   $env:MOTRAE_SUPABASE_URL = "https://ixttslqbbwqfcqjmttyg.supabase.co"
 *   $env:MOTRAE_SUPABASE_SERVICE_ROLE = "..."
 *   corepack pnpm@9.15.0 --filter @motrest/central alta-nube -- --sucursal suc-rodizio --nombre "Rodizio"
 *
 * Se usa `fetch` a secas y no `@supabase/supabase-js` a propósito: Central es la
 * aplicación que menos superficie debe tener —aquí dentro viven las privadas
 * Ed25519 con las que se firman licencias y manifiestos— y para tres llamadas
 * HTTP no compensa arrastrar un SDK entero (mismo criterio que ADR-26 §6).
 */
import { randomBytes } from "node:crypto";

/**
 * El dominio de los buzones de los Hubs.
 *
 * No recibe correo ni falta que hace: Supabase Auth exige un correo como
 * identificador y aquí se usa como tal y nada más. Las altas se crean ya
 * confirmadas, así que nadie espera un mensaje que no va a llegar.
 */
const DOMINIO_HUBS = "hubs.motrae.mx";

interface Opciones {
  sucursal: string;
  nombre: string;
}

/**
 * La credencial con la que el Hub de este local se identifica ante la nube.
 *
 * 32 bytes de azar — 256 bits, 43 caracteres. No es una contraseña que nadie
 * teclee de memoria: viaja dentro de la licencia firmada y se pega una vez. Por
 * eso puede ser larga, y por eso conviene que lo sea.
 *
 * Cabe de sobra en el tope de 72 bytes de bcrypt, que es con lo que Supabase la
 * guarda. Y la regla de siempre sigue en pie: **esto vale mientras la credencial
 * la genere esta función**. El día que se deje que un humano elija una, hay que
 * mirar de nuevo todo lo que cuelga de que sea impredecible.
 */
function generarCredencial(): string {
  return randomBytes(32).toString("base64url");
}

function leerArgumentos(argv: string[]): Opciones | string {
  /*
   * SE BUSCAN LAS BANDERAS, NO SE AVANZA DE DOS EN DOS.
   *
   * Iba a saltos fijos, y eso se rompe con un solo argumento de mas. pnpm
   * pasa el `--` separador al script tal cual, asi que argv llegaba como
   * ["--", "--sucursal", "suc-x", …]: el primero se descartaba por vacio, el
   * indice quedaba corrido, y a partir de ahi cada valor se leia como si fuera
   * una bandera. El resultado era «Faltan --sucursal y/o --nombre» teniendolos
   * los dos delante — un error que manda a mirar justo donde no esta el fallo.
   */
  const dado = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const bruto = argv[i] ?? "";
    if (!bruto.startsWith("--")) continue;
    const clave = bruto.slice(2);
    if (!clave) continue; // el `--` a secas es un separador, no una bandera
    const valor = argv[i + 1] ?? "";
    dado.set(clave, valor.startsWith("--") ? "" : valor);
  }

  const sucursal = dado.get("sucursal")?.trim() ?? "";
  const nombre = dado.get("nombre")?.trim() ?? "";

  if (!sucursal || !nombre) {
    return "Faltan --sucursal y/o --nombre.";
  }
  /*
   * La misma forma que exige la restricción de la tabla. Se comprueba aquí para
   * que el error diga qué pasa, en vez de llegar como un fallo de Postgres a
   * mitad del alta con el usuario de Auth ya creado.
   */
  if (!/^suc-[A-Za-z0-9-]{1,60}$/.test(sucursal)) {
    return `"${sucursal}" no tiene forma de sucursal. El Hub la escribe en <datos>/sucursal.txt al instalarse: cópiala de ahí.`;
  }
  return { sucursal, nombre };
}

function entorno(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    console.error(`Falta ${nombre}. Sin ella no se puede dar de alta a nadie.`);
    process.exit(1);
  }
  return valor;
}

async function principal(): Promise<void> {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (typeof opciones === "string") {
    console.error(opciones);
    console.error(
      '\nUso: alta-nube -- --sucursal suc-rodizio --nombre "Rodizio"',
    );
    process.exit(1);
  }

  const url = entorno("MOTRAE_SUPABASE_URL").replace(/\/+$/, "");
  const servicio = entorno("MOTRAE_SUPABASE_SERVICE_ROLE");
  const { sucursal, nombre } = opciones;
  const credencial = generarCredencial();

  const cabeceras = {
    apikey: servicio,
    authorization: `Bearer ${servicio}`,
    "content-type": "application/json",
  };

  /*
   * PRIMERO EL USUARIO, DESPUÉS LA FICHA, y el orden importa.
   *
   * De esta llamada sale el `sucursal_id` dentro de `app_metadata`, que es lo
   * único que la base de datos va a creerse después sobre quién es este Hub:
   * lo firma Supabase Auth y el Hub no puede escribirlo. Si esto falla, no
   * queda una ficha huérfana en el padrón a la que nadie puede conectarse.
   */
  const alta = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({
      email: `${sucursal}@${DOMINIO_HUBS}`,
      password: credencial,
      email_confirm: true,
      app_metadata: { sucursal_id: sucursal },
    }),
  });

  if (!alta.ok) {
    const detalle = await alta.text();
    console.error(`No se pudo crear la identidad de ${sucursal}: ${detalle}`);
    process.exit(1);
  }

  const ficha = await fetch(`${url}/rest/v1/sucursales`, {
    method: "POST",
    headers: { ...cabeceras, prefer: "return=minimal" },
    body: JSON.stringify({ sucursal_id: sucursal, nombre }),
  });

  if (!ficha.ok) {
    const detalle = await ficha.text();
    console.error(`Se creó la identidad pero no la ficha de ${sucursal}: ${detalle}`);
    console.error(
      "Queda un usuario de Auth sin padrón. Bórralo antes de reintentar, o el alta dirá que el correo ya existe.",
    );
    process.exit(1);
  }

  /*
   * La credencial SE ENSEÑA UNA SOLA VEZ.
   *
   * Supabase guarda su hash bcrypt y no la devuelve nunca más. De ella sale la
   * identidad del local ante la nube, así que es de este restaurante y de
   * ningún otro: quien la tiene, es el local.
   *
   * No se pega a mano en la caja: va dentro de la licencia firmada, que es lo
   * que ya se lleva a cada alta.
   */
  console.log(`
${nombre} está de alta en la nube de MotRest.

  Sucursal:    ${sucursal}
  URL:         ${url}
  Credencial:  ${credencial}

La credencial NO se vuelve a mostrar. Emite la licencia con estos datos:

  corepack pnpm@9.15.0 --filter @motrest/central licencia -- --sucursal ${sucursal} --nombre "${nombre}" ...
`);
}

void principal().catch((causa) => {
  console.error(`El alta no se completó: ${String(causa)}`);
  process.exit(1);
});
