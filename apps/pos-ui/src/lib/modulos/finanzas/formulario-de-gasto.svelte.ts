/**
 * El formulario de «Registrar gasto», compartido por dos tarjetas (1.5.6).
 *
 * Desde que los gastos tienen su propia tarjeta, «Registrar gasto» está en dos
 * sitios —en la venta del día, donde siempre estuvo, y en Gastos— pero el
 * formulario es UNO: el de la compra de insumos con sus renglones de almacén.
 * Dos copias acabarían diferenciándose, y el día que una cargue el almacén y
 * la otra no, nadie sabría cuál se usó.
 *
 * `pedido` cambia en cada toque para que el formulario vuelva a la vista aunque
 * ya estuviera abierto: quien pulsa en Gastos, más abajo, tiene que verlo.
 */
export const formularioDeGasto = $state({ abierto: false, pedido: 0 });

export function abrirFormularioDeGasto(): void {
  formularioDeGasto.abierto = true;
  formularioDeGasto.pedido++;
}
