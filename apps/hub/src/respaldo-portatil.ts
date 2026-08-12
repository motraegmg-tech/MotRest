/**
 * Llevarse un restaurante a otra computadora.
 *
 * ## Qué problema resuelve, y cuál NO
 *
 * El Hub ya guarda copias automáticas en `datos/respaldos`, y eso sirve para
 * volver atrás EN LA MISMA MÁQUINA. No sirve para lo que pasa de verdad: la
 * computadora de la caja se muere, o el restaurante compra una nueva, y toda su
 * operación —ventas, carta, plano, personal, inventario— está en un disco que
 * ya no arranca o que nadie sabe abrir.
 *
 * Esto es lo otro: un archivo que se copia a una USB, se guarda, y se vuelca en
 * un equipo nuevo.
 *
 * ## Las tres decisiones que lo gobiernan
 *
 * **Va cifrado.** Dentro hay las ventas del negocio, la ficha de sus clientes y
 * los PIN del personal. Una USB olvidada en la barra no puede ser el historial
 * completo del restaurante en claro. La contraseña no viaja con el archivo:
 * viaja en la licencia firmada, así que un respaldo perdido no sirve sin el
 * documento que lo acompaña, y esas dos cosas no suelen extraviarse juntas.
 *
 * **Restaurar REEMPLAZA, y solo sobre un local vacío.** Fusionar suena mejor y
 * es como se duplican las ventas: dos registros con las mismas comandas
 * mezcladas no hay quien los desenrede después. Si el equipo ya operó, se niega
 * y se dice por qué. Vaciar por dentro para «hacer sitio» tampoco: si alguien
 * se equivoca de máquina, el error tiene que ser recuperable.
 *
 * **El permiso lo da MOTRAE y caduca.** Exportar es libre —guardar copias es
 * sano—, pero volcarlas en otro equipo necesita autorización con fecha. Sin
 * eso, un respaldo robado es una copia funcionante del negocio en la máquina de
 * cualquiera.
 */
import { abrirCofre, cerrarCofre, esCofre } from "@motrest/dominio";
import type { EventoBase } from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";

/** Sube si el formato cambia de forma que un archivo viejo ya no encaje. */
export const VERSION_RESPALDO = 1;

export interface ContenidoRespaldo {
  version: number;
  sucursal_id: string;
  /** Cuándo se sacó. Se enseña antes de restaurar: importa de cuándo es. */
  creado_ts: number;
  /** Nombre del local al exportar, para reconocer el archivo sin abrirlo. */
  nombre: string;
  eventos: EventoBase[];
  /** Catálogos y ajustes: carta, plano, impresoras, ficha del local. */
  estado: Record<string, unknown>;
}

/**
 * Empaqueta y cifra todo lo que hace falta para levantar el local en otro sitio.
 *
 * Lo que NO va dentro: la licencia y los certificados. La licencia se pega
 * aparte —es el documento que autoriza la restauración, no puede ir dentro de
 * lo que autoriza— y el certificado TLS es de la máquina, no del negocio: el
 * equipo nuevo genera el suyo al arrancar.
 */
export async function exportarRespaldo(
  log: LogHub,
  sucursalId: string,
  nombre: string,
  estado: Record<string, unknown>,
  clave: string,
): Promise<string> {
  const eventos: EventoBase[] = [];
  // Por tandas: el registro de un local con años de operación no cabe de golpe
  // en memoria sin riesgo, y aquí no hay prisa.
  let desde = 0;
  for (;;) {
    const tanda = log.desde(desde, 500);
    if (tanda.length === 0) break;
    eventos.push(...tanda);
    desde = tanda[tanda.length - 1]!.seq;
  }

  const contenido: ContenidoRespaldo = {
    version: VERSION_RESPALDO,
    sucursal_id: sucursalId,
    creado_ts: Date.now(),
    nombre,
    eventos,
    estado,
  };

  const cofre = await cerrarCofre(JSON.stringify(contenido), clave);
  return JSON.stringify(cofre, null, 2);
}

export type ResultadoLectura =
  | { ok: true; contenido: ContenidoRespaldo }
  | { ok: false; error: string };

/**
 * Abre un respaldo y comprueba que es de este restaurante.
 *
 * Lo del `sucursal_id` no es burocracia: sin esa comprobación, el respaldo de
 * un local se podría volcar en la caja de otro, y a partir de ahí los dos
 * emiten eventos con el mismo identificador. El registro de los dos negocios
 * queda mezclado y ya no hay forma de separarlos.
 */
export async function leerRespaldo(
  texto: string,
  clave: string,
  sucursalEsperada: string,
): Promise<ResultadoLectura> {
  let cofre: unknown;
  try {
    cofre = JSON.parse(texto);
  } catch {
    return { ok: false, error: "El archivo no es un respaldo de MotRest" };
  }
  if (!esCofre(cofre)) return { ok: false, error: "El archivo no es un respaldo de MotRest" };

  const claro = await abrirCofre(cofre, clave);
  if (claro === null) {
    return {
      ok: false,
      error: "El respaldo no se pudo abrir: es de otro restaurante o la licencia no corresponde",
    };
  }

  let contenido: ContenidoRespaldo;
  try {
    contenido = JSON.parse(claro) as ContenidoRespaldo;
  } catch {
    return { ok: false, error: "El respaldo está dañado" };
  }

  if (contenido.version > VERSION_RESPALDO) {
    return {
      ok: false,
      error: "El respaldo viene de una versión más nueva de MotRest. Actualice este equipo primero.",
    };
  }
  if (contenido.sucursal_id !== sucursalEsperada) {
    return {
      ok: false,
      error: `El respaldo es de otro local (${contenido.sucursal_id}) y no del de esta licencia`,
    };
  }
  if (!Array.isArray(contenido.eventos)) {
    return { ok: false, error: "El respaldo no trae la operación del local" };
  }

  return { ok: true, contenido };
}
