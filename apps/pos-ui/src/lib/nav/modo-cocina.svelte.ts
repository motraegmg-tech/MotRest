/**
 * La tablet que SOLO es pantalla de cocina.
 *
 * ## Qué problema resuelve
 *
 * El KDS no es una aplicación aparte: es el mismo POS abierto en su módulo de
 * cocina, y eso está bien —un solo tablero, un solo sitio que arreglar—. Lo que
 * no está bien es que en la tablet de la cocina se pinte también el carril de
 * los nueve módulos y la barra del usuario. Son 15rem de ancho y 4rem de alto
 * que nadie va a tocar: en esa pantalla no se navega, se mira. Y son 15rem que
 * le faltan a las comandas, que es lo único que importa ahí.
 *
 * ## Por qué NO se decide por la ruta
 *
 * Sería fácil decir «si la ruta es cocina, esconde el carril». Sería un error:
 * el gerente entra al tablero desde la caja para ver cómo va el servicio, y ahí
 * sí quiere poder salir a Finanzas sin recargar. Lo que cambia no es la
 * pantalla, es el APARATO: uno está dedicado a la cocina y el otro no.
 *
 * Por eso es una bandera explícita que pone el APK al empaquetar
 * (`?cocina=1`), y que se guarda: la tablet la recibe una vez y la conserva
 * aunque alguien recargue.
 *
 * ## Cómo se apaga
 *
 * Con `?cocina=0`. Hace falta: si la bandera solo se pudiera encender, una
 * tablet mal configurada quedaría sin forma de volver al POS completo salvo
 * borrando los datos del navegador.
 */
const LLAVE = "motrest.modo-cocina";

function leerBandera(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const parametro = new URLSearchParams(window.location.search).get("cocina");
    if (parametro === "1") {
      window.localStorage.setItem(LLAVE, "1");
      return true;
    }
    if (parametro === "0") {
      window.localStorage.removeItem(LLAVE);
      return false;
    }
    return window.localStorage.getItem(LLAVE) === "1";
  } catch {
    /*
     * Un navegador con el almacenamiento bloqueado no debe dejar la pantalla
     * de cocina sin arrancar. Se cae al modo normal, que funciona igual solo
     * que con el carril puesto.
     */
    return false;
  }
}

class ModoCocina {
  /** true = este aparato es una pantalla de cocina y nada más. */
  readonly activo: boolean = leerBandera();
}

export const modoCocina = new ModoCocina();
