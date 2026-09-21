/**
 * Las dos herramientas que comparten TODAS las listas largas de la caja (1.5.6).
 *
 * 1. PAGINAR («Ver más»). Pedido de Gonzalo: las listas extensas —el
 *    movimiento del dinero, las cuentas cobradas— hacían la página tan larga
 *    que costaba llegar a lo que había debajo. Ahora se ven 10 renglones al
 *    entrar y 15 más cada vez que se pulsa «Ver más», mientras quede algo.
 *
 * 2. ORDENAR. Cada lista que el usuario llena —categorías, productos,
 *    clientes, insumos…— tiene su botón para ordenarla por fecha o por nombre.
 *    En casi todas solo cambia la VISTA; en la carta, por decisión de Gonzalo,
 *    cambia también el orden en que la ven los meseros (eso lo hace la propia
 *    pantalla del menú, con confirmación).
 *
 * Viven en un solo sitio a propósito: copiadas en veinte pantallas, la
 * siguiente que se escribiera nacería sin ellas o con otro número de renglones.
 */

/** Renglones al entrar, y cuántos más trae cada «Ver más». Pedido de Gonzalo. */
export const PRIMEROS = 10;
export const PASO = 15;

/**
 * Cuántos renglones de una lista se ven.
 *
 * Se crea UNO por lista, dentro del componente: `const pag = new Paginado()`.
 * Cuando la lista cambia de fondo —otro filtro, otro mes, otro orden— hay que
 * llamar a `reiniciar()`, o quien estaba viendo 55 renglones de «Todo» los
 * seguiría viendo al pasar a «Hoy» y la página volvería a ser eterna.
 */
export class Paginado {
  visibles = $state(PRIMEROS);

  constructor(
    private readonly primeros = PRIMEROS,
    private readonly paso = PASO,
  ) {
    this.visibles = primeros;
  }

  /** Los renglones que toca enseñar. */
  de<T>(lista: readonly T[]): T[] {
    return lista.slice(0, this.visibles);
  }

  /** Cuántos quedan escondidos. */
  restantes(lista: readonly unknown[]): number {
    return Math.max(0, lista.length - this.visibles);
  }

  verMas(): void {
    this.visibles += this.paso;
  }

  reiniciar(): void {
    this.visibles = this.primeros;
  }
}

// --- Ordenar -----------------------------------------------------------------------

/** Una forma de ordenar, tal como se ofrece en el botón. */
export interface OpcionOrden<T> {
  id: string;
  etiqueta: string;
  comparar: (a: T, b: T) => number;
}

/** Español de México: «Ñandú» va después de «Nabo», y los acentos no desordenan. */
const colador = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/** Las cuatro formas de siempre, armadas a partir de cómo se lee el nombre y la fecha. */
export function ordenesComunes<T>(campos: {
  nombre: (x: T) => string;
  /** Sin fecha, la lista no ofrece «más recientes» ni «más antiguos». */
  fecha?: (x: T) => number | undefined;
}): OpcionOrden<T>[] {
  const opciones: OpcionOrden<T>[] = [
    { id: "az", etiqueta: "De la A a la Z", comparar: (a, b) => colador.compare(campos.nombre(a), campos.nombre(b)) },
    { id: "za", etiqueta: "De la Z a la A", comparar: (a, b) => colador.compare(campos.nombre(b), campos.nombre(a)) },
  ];
  const fecha = campos.fecha;
  if (fecha) {
    opciones.unshift(
      { id: "recientes", etiqueta: "Más recientes primero", comparar: (a, b) => (fecha(b) ?? 0) - (fecha(a) ?? 0) },
      { id: "antiguos", etiqueta: "Más antiguos primero", comparar: (a, b) => (fecha(a) ?? 0) - (fecha(b) ?? 0) },
    );
  }
  return opciones;
}

/** Ordena sin tocar la lista original (que casi siempre es un estado de Svelte). */
export function ordenar<T>(lista: readonly T[], opcion: OpcionOrden<T> | undefined): T[] {
  return opcion ? [...lista].sort(opcion.comparar) : [...lista];
}

/**
 * El orden que eligió esta terminal para esta lista, recordado.
 *
 * Es una comodidad de ESTE dispositivo —quien siempre busca clientes por
 * nombre no tiene que volver a pedirlo cada vez— y por eso vive en el
 * almacenamiento del navegador y no en el registro del local. Todo va dentro
 * de try/catch: en una ventana privada o con los datos del sitio bloqueados el
 * almacenamiento lanza, y eso no puede tumbar una lista.
 */
const PREFIJO = "motrest.orden.";

export function ordenRecordado(lista: string, porDefecto: string): string {
  try {
    return window.localStorage.getItem(PREFIJO + lista) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

export function recordarOrden(lista: string, id: string): void {
  try {
    window.localStorage.setItem(PREFIJO + lista, id);
  } catch {
    // Sin almacenamiento, el orden dura lo que la pantalla: no es grave.
  }
}
