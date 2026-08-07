/**
 * El alta de restaurantes en el relay, desde la línea de comandos.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Porque antes no existía. El padrón se llenaba solo: el primer Hub que se
 * conectara con la clave compartida quedaba dado de alta. Eso no es dar de alta,
 * es dejar la puerta abierta y anotar quién entró.
 *
 * Aquí un restaurante entra porque MOTRAE lo mete, y sale porque MOTRAE lo saca.
 * El relay se limita a comprobar credenciales.
 *
 * SE CORRE EN EL SERVIDOR DEL RELAY, no en la máquina de nadie: necesita el
 * archivo del padrón y la llave con la que está cifrado.
 *
 *   pnpm --filter @motrest/relay padron llave
 *   pnpm --filter @motrest/relay padron alta suc-rodizio "Rodizio"
 *   pnpm --filter @motrest/relay padron lista
 *   pnpm --filter @motrest/relay padron rotar suc-rodizio
 *   pnpm --filter @motrest/relay padron baja suc-rodizio
 */
import { randomBytes } from "node:crypto";
import { Inquilinos, llaveDelPadron } from "./inquilinos.js";

const RUTA = process.env.MOTREST_RELAY_PADRON ?? "./datos/restaurantes.json";

function ayuda(): never {
  console.log(`
Padrón del relay de MotRest

  padron llave                     genera una MOTREST_RELAY_LLAVE_PADRON nueva
  padron alta <sucursal> <nombre>  da de alta un restaurante y enseña su credencial
  padron lista                     los restaurantes del padrón
  padron rotar <sucursal>          credencial nueva (corta el enlace vivo)
  padron baja <sucursal>           lo saca del padrón y olvida sus credenciales

El id de sucursal es el que el Hub del restaurante escribe en su registro al
arrancar, y que guarda en <datos>/sucursal.txt. No te lo inventes: cópialo.
`);
  process.exit(1);
}

/**
 * La credencial se enseña UNA VEZ y con instrucciones.
 *
 * Se imprime aparte y con el aviso pegado porque es el único momento de su vida
 * en que existe en claro: el padrón solo guarda su huella. Si se pierde, no se
 * recupera — se rota.
 */
function enseñarCredencial(sucursalId: string, credencial: string): void {
  console.log(`
  Sucursal:   ${sucursalId}
  Credencial: ${credencial}

  ANÓTALA AHORA. No se puede volver a ver: el padrón solo guarda su huella.
  Si se pierde, se genera otra con "padron rotar ${sucursalId}".

  En el Hub del restaurante, en Administración → Hub del local → WhatsApp:
    URL del relay:  wss://<tu-dominio>/hub
    Credencial:     la de arriba
`);
}

function main(): void {
  const [orden, ...resto] = process.argv.slice(2);

  if (orden === "llave") {
    // No abre el padrón: es justo lo que se corre cuando todavía no hay llave.
    console.log(randomBytes(32).toString("base64"));
    return;
  }

  if (!orden || orden === "ayuda" || orden === "--help") ayuda();

  const padron = new Inquilinos(RUTA, llaveDelPadron(process.env.MOTREST_RELAY_LLAVE_PADRON), (t) =>
    console.error(t),
  );

  if (orden === "lista") {
    const lista = padron.lista();
    if (lista.length === 0) {
      console.log("El padrón está vacío.");
      return;
    }
    for (const i of lista) {
      const alta = i.alta_ts ? new Date(i.alta_ts).toISOString().slice(0, 10) : "—";
      console.log(`${i.sucursal_id}\t${i.whatsapp ? "WhatsApp" : "sin número"}\t${alta}\t${i.nombre}`);
    }
    return;
  }

  const sucursal = resto[0];
  if (!sucursal) ayuda();

  if (orden === "alta") {
    enseñarCredencial(sucursal, padron.darDeAlta(sucursal, resto.slice(1).join(" ")));
    return;
  }

  if (orden === "rotar") {
    enseñarCredencial(sucursal, padron.rotarCredencial(sucursal));
    return;
  }

  if (orden === "baja") {
    console.log(
      padron.darDeBaja(sucursal)
        ? `${sucursal} salió del padrón. Sus credenciales de Meta ya no están aquí.`
        : `${sucursal} no estaba en el padrón.`,
    );
    return;
  }

  ayuda();
}

try {
  main();
} catch (causa) {
  console.error(causa instanceof Error ? causa.message : String(causa));
  process.exit(1);
}
