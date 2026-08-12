/** Datos del local y de presentación. */
import { uuidv7 } from "@motrest/dominio";
import type { ID } from "@motrest/dominio";

/**
 * Identificador del local al que pertenece esta terminal.
 *
 * ## Por qué ya no es un literal
 *
 * Estaba escrito aquí, igual en toda instalación. Con un solo restaurante no se
 * notaba; con dos es un choque: los dos locales se llaman igual ante el relay y
 * ante MotRest Central, y la licencia de uno vale en el otro.
 *
 * Ahora lo dice **el Hub del local**, que a su vez lo toma de la licencia que
 * MOTRAE emite. Así el restaurante queda identificado por el documento firmado
 * que se pega al instalar, y no por una constante del código.
 *
 * ## Se resuelve al importar, y no más tarde
 *
 * Media docena de módulos calculan su stream al cargarse
 * (`const STREAM = streamFiscal(SUCURSAL_ID)`). Si esto se resolviera de forma
 * asíncrona, esos streams quedarían apuntando al identificador equivocado y los
 * eventos irían a un sitio del que nadie los lee. Las tres fuentes son
 * síncronas a propósito.
 */
const LLAVE_SUCURSAL = "motrest.sucursal_id";

/**
 * Un identificador provisional PROPIO de esta terminal.
 *
 * Aquí había una constante con el identificador de Rodizio, heredada de cuando
 * era el único local. El problema no era el nombre sino la colisión: dos
 * restaurantes recién instalados nacían con el MISMO identificador de sucursal,
 * se anunciaban igual ante el relay y ante Central, y la licencia de uno habría
 * valido en el otro.
 *
 * Se genera uno único y se guarda, exactamente como hace el Hub cuando arranca
 * sin identidad (`sucursalDelLocal` en `apps/hub/src/main.ts`). Es feo de leer y
 * no importa: dura hasta que se pega la licencia firmada, que trae el
 * identificador de verdad y lo sustituye.
 *
 * Las terminales que ya operaban conservan el suyo: esta rama solo se toca
 * cuando no hay nada guardado, así que la historia de Rodizio sigue sellada con
 * el identificador con el que se registró.
 */
function sucursalProvisional(): ID {
  return `suc-${uuidv7().slice(0, 8)}`;
}

function resolverSucursal(): ID {
  // 1. La caja: su propio Hub se lo inyecta en la página que le sirve.
  const inyectado = (globalThis as { __MOTREST_HUB__?: { sucursal_id?: string } })
    .__MOTREST_HUB__?.sucursal_id;
  if (inyectado) return recordarSucursal(inyectado);

  // 2. Una terminal que acaba de escanear el QR de emparejamiento.
  if (typeof location !== "undefined") {
    const enLaUrl = new URLSearchParams(location.search).get("s")?.trim();
    if (enLaUrl) return recordarSucursal(enLaUrl);
  }

  // 3. Lo que esta terminal ya aprendió. Sobrevive a abrir sin el Hub delante.
  try {
    const guardado = localStorage.getItem(LLAVE_SUCURSAL);
    if (guardado) return guardado;
  } catch {
    // Sin almacenamiento no se recuerda nada; se genera uno para esta sesión.
    return sucursalProvisional();
  }

  // 4. Nadie sabe todavía qué local es esto: uno propio, y se recuerda.
  return recordarSucursal(sucursalProvisional());
}

function recordarSucursal(id: ID): ID {
  try {
    localStorage.setItem(LLAVE_SUCURSAL, id);
  } catch {
    // Sin dónde guardarlo se opera igual: el Hub lo vuelve a decir al abrir.
  }
  return id;
}

export const SUCURSAL_ID: ID = resolverSucursal();

/**
 * ¿Es una instalación de demostración?
 *
 * `true` en desarrollo y en las pruebas; `false` únicamente en el `vite build`
 * que se empaqueta para el restaurante. De aquí cuelga todo lo que existe solo
 * para probar —usuarios de juguete, salón sembrado con comandas falsas— y que
 * NO debe llegar al instalador real, que arranca limpio.
 */
export const MODO_DEMO = import.meta.env.PROD !== true;

/**
 * Empleado con el que se sella la semilla del salón, y respaldo cuando aún no
 * hay sesión.
 *
 * Es el id del **responsable del restaurante** (`USUARIO_RESPONSABLE_ID`), el
 * mismo en toda instalación: lo recibe la cuenta que el local crea en su primer
 * arranque y también la que MOTRAE provisiona por licencia. Así la bitácora no
 * queda con un identificador huérfano ni siquiera en los eventos que se emiten
 * antes de que alguien inicie sesión.
 */
export const EMPLEADO_ACTUAL: ID = "usr-gonzalo";

/**
 * A quién llama el restaurante para reactivar su licencia.
 *
 * Sale en la pantalla de bloqueo. Es un teléfono y no un correo a propósito: lo
 * que el restaurante necesita en ese momento es reactivarse ya, y cada paso
 * entre el bloqueo y el pago es un día más sin cobrar.
 */
export const CONTACTO_MOTRAE = "MOTRAE · 2283536911";

/**
 * EL PRODUCTO NO SE LLAMA COMO SU PRIMER CLIENTE.
 *
 * Aquí ponía `sucursal: "Rodizio"` y unos `datosLocal` con su dirección y su
 * RFC. Eran valores de desarrollo que se quedaron: cualquier restaurante que
 * instalara MotRest veía «Rodizio» en la cabecera de su propio punto de venta y
 * lo imprimía en los tickets que entregaba a sus comensales.
 *
 * El nombre de un local sale de UN sitio: la licencia firmada que MOTRAE emite
 * al darlo de alta. Mientras no haya licencia no hay restaurante todavía, y lo
 * honesto es no decir ninguno.
 */
export const cabecera = {
  titulo: "Punto de venta",
  /** Lo rellena `local.svelte.ts` con lo que diga la licencia. */
  sucursal: "",
};

/**
 * Respaldo de la cabecera del ticket cuando el local no ha llenado su ficha.
 *
 * Todo vacío a propósito. La plantilla omite las líneas vacías, así que un
 * restaurante sin configurar imprime solo su nombre —el de la licencia— y nada
 * inventado. Se captura en Administración → Impresoras.
 */
export const datosLocal = {
  nombre: "",
  direccion: "",
  rfc: "",
  telefono: "",
};

/**
 * Identidad del dispositivo, persistida en el navegador.
 * Sustituye al antiguo `"pos-caja-01"` hardcodeado: cada equipo tiene su UUID.
 */
const LLAVE_DEVICE = "motrest.device_id";

export function obtenerDeviceId(): ID {
  if (typeof localStorage === "undefined") return "dev-efimero";
  const guardado = localStorage.getItem(LLAVE_DEVICE);
  if (guardado) return guardado;
  const nuevo = uuidv7();
  localStorage.setItem(LLAVE_DEVICE, nuevo);
  return nuevo;
}

/**
 * Las mesas ya no viven aquí: son parte del plano de piso que cada restaurante
 * edita (ver `plano.svelte.ts` y `catalogo/areas.ts` en el dominio).
 */
