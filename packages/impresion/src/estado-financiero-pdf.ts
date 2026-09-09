/**
 * El estado financiero del mes, dibujado en una hoja carta.
 *
 * ## A quién se lo va a dar el restaurantero
 *
 * A tres personas, y por eso el orden de las secciones es el que es:
 *
 * - **A sí mismo**, para saber cómo fue el mes: por eso lo primero son cuatro
 *   cifras grandes que se leen de pie y sin lentes.
 * - **A su contador**, que busca la venta, el IVA y los gastos con comprobante.
 * - **Al banco o a un socio**, que quiere ver que el negocio gana y que el
 *   dinero cuadra.
 *
 * ## La decisión de maqueta que importa
 *
 * El resultado y el dinero van en DOS bloques separados y con esa distinción
 * escrita en el papel. Un mes puede cerrar con utilidad y con menos dinero en
 * la caja —se surtió la despensa— y quien vea las dos cifras juntas sin
 * explicación pensará que el sistema se equivocó. La explicación va impresa,
 * no en la cabeza de quien lo entrega.
 */
import type {
  BloqueGastos,
  Centavos,
  EstadoFinanciero,
  RenglonConSaldo,
} from "@motrest/dominio";
import { CARTA, DocumentoPdf, Pagina, recortar } from "./pdf.js";

const MARGEN = 54;
const ANCHO_UTIL = CARTA.ancho - MARGEN * 2;
const DERECHA = CARTA.ancho - MARGEN;
/** Por debajo de aquí ya no cabe otro renglón: toca hoja nueva. */
const PIE = CARTA.alto - 64;

const VERDE = 0.35;

// --- Formato ------------------------------------------------------------------------------

/** `$1,234.56`. Se escribe a mano para que el papel no dependa del `Intl` del aparato. */
export function importe(monto: Centavos): string {
  const negativo = monto < 0;
  const centavos = Math.abs(Math.round(monto));
  const enteros = Math.floor(centavos / 100);
  const decimales = String(centavos % 100).padStart(2, "0");

  const conComas = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negativo ? "-" : ""}$${conComas}.${decimales}`;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fechaCorta(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fechaLarga(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** «septiembre de 2026», el título del informe. */
export function nombreDelPeriodo(desde: number): string {
  const d = new Date(desde);
  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function porcentaje(fraccion: number): string {
  return `${(fraccion * 100).toFixed(1)} %`;
}

// --- La maqueta ----------------------------------------------------------------------------

/**
 * Lleva la cuenta de por dónde va la hoja y cambia de página sola.
 *
 * Sin esto, cada sección tendría que calcular si cabe, y un restaurante con
 * ciento veinte gastos en el mes escribiría los últimos treinta fuera del
 * papel. El salto de página no se decide al maquetar: se pide sitio y la
 * maqueta responde.
 */
class Maqueta {
  private pagina: Pagina;
  private y = 0;
  private numero = 0;

  constructor(
    private doc: DocumentoPdf,
    private estado: EstadoFinanciero,
  ) {
    this.pagina = this.abrirPagina();
  }

  private abrirPagina(): Pagina {
    this.numero += 1;
    const pagina = this.doc.nuevaPagina();

    if (this.numero === 1) {
      this.y = this.encabezadoPrincipal(pagina);
    } else {
      pagina.texto(MARGEN, 44, this.estado.local, { fuente: "negrita", tamano: 9, gris: 0.45 });
      pagina.texto(DERECHA, 44, `Estado financiero · ${nombreDelPeriodo(this.estado.desde)}`, {
        tamano: 9,
        gris: 0.45,
        alineacion: "derecha",
      });
      pagina.linea(MARGEN, 52, DERECHA);
      this.y = 76;
    }

    this.pie(pagina);
    return pagina;
  }

  /** El membrete de la primera hoja. Devuelve la `y` donde empieza el contenido. */
  private encabezadoPrincipal(pagina: Pagina): number {
    pagina.rectangulo(MARGEN, 46, 4, 44, VERDE);
    pagina.texto(MARGEN + 14, 62, this.estado.local, { fuente: "negrita", tamano: 17 });
    pagina.texto(MARGEN + 14, 80, `Estado financiero · ${nombreDelPeriodo(this.estado.desde)}`, {
      tamano: 11,
      gris: 0.35,
    });

    pagina.texto(DERECHA, 62, "MotRest", {
      fuente: "negrita",
      tamano: 11,
      gris: 0.45,
      alineacion: "derecha",
    });
    pagina.texto(DERECHA, 76, `Emitido el ${fechaLarga(this.estado.emitido_ts)}`, {
      tamano: 8,
      gris: 0.5,
      alineacion: "derecha",
    });
    pagina.texto(
      DERECHA,
      87,
      `Del ${fechaLarga(this.estado.desde)} al ${fechaLarga(this.estado.hasta - 1)}`,
      { tamano: 8, gris: 0.5, alineacion: "derecha" },
    );

    return 112;
  }

  private pie(pagina: Pagina): void {
    pagina.linea(MARGEN, CARTA.alto - 46, DERECHA, 0.5, 0.85);
    pagina.texto(MARGEN, CARTA.alto - 34, "MOTRAE · Innovation already in motion", {
      tamano: 7.5,
      gris: 0.6,
    });
    pagina.texto(DERECHA, CARTA.alto - 34, `Página ${this.numero}`, {
      tamano: 7.5,
      gris: 0.6,
      alineacion: "derecha",
    });
  }

  /** Pide sitio para lo que viene. Si no cabe, abre hoja nueva. */
  asegurar(alto: number): void {
    if (this.y + alto > PIE) this.pagina = this.abrirPagina();
  }

  avanzar(alto: number): void {
    this.y += alto;
  }

  get cursor(): number {
    return this.y;
  }

  get hoja(): Pagina {
    return this.pagina;
  }

  // --- Piezas reutilizables ------------------------------------------------------------

  titulo(texto: string, explica?: string): void {
    this.asegurar(explica ? 46 : 34);
    this.pagina.rectangulo(MARGEN, this.y - 2, ANCHO_UTIL, 18, 0.94);
    this.pagina.texto(MARGEN + 7, this.y + 11, texto.toUpperCase(), {
      fuente: "negrita",
      tamano: 9,
      gris: 0.2,
    });
    this.y += 24;

    if (explica) {
      this.pagina.texto(MARGEN, this.y + 6, explica, { tamano: 8, gris: 0.45 });
      this.y += 16;
    }
    this.y += 4;
  }

  /** Un renglón «concepto … importe». El pan de todo el informe. */
  renglon(
    concepto: string,
    monto: Centavos | string,
    opciones: { fuerte?: boolean; sangria?: number; nota?: string; gris?: number } = {},
  ): void {
    this.asegurar(15);
    const x = MARGEN + (opciones.sangria ?? 0);
    const gris = opciones.gris ?? (opciones.sangria ? 0.35 : 0.1);

    this.pagina.texto(x, this.y + 9, recortar(concepto, "normal", 9, 300), {
      fuente: opciones.fuerte ? "negrita" : "normal",
      tamano: 9,
      gris,
    });

    if (opciones.nota) {
      this.pagina.texto(MARGEN + 320, this.y + 9, recortar(opciones.nota, "normal", 8, 110), {
        tamano: 8,
        gris: 0.55,
      });
    }

    this.pagina.texto(DERECHA, this.y + 9, typeof monto === "string" ? monto : importe(monto), {
      fuente: opciones.fuerte ? "cifra-negrita" : "cifra",
      tamano: 9,
      gris,
      alineacion: "derecha",
    });
    this.y += 15;
  }

  separador(): void {
    this.pagina.linea(MARGEN, this.y + 2, DERECHA, 0.5, 0.82);
    this.y += 6;
  }

  espacio(alto = 12): void {
    this.y += alto;
  }

  /** Una nota al pie de una sección, en letra chica. */
  nota(texto: string): void {
    this.asegurar(14);
    this.pagina.texto(MARGEN, this.y + 8, texto, { tamano: 7.5, gris: 0.5 });
    this.y += 14;
  }
}

// --- Las secciones ---------------------------------------------------------------------------

/**
 * Las cuatro cifras de arriba.
 *
 * Es lo único que mucha gente va a mirar, así que son las cuatro que de verdad
 * resumen un mes: lo que se vendió, lo que se gastó, si se ganó y con cuánto
 * dinero se cerró.
 */
function tarjetasResumen(m: Maqueta, estado: EstadoFinanciero): void {
  m.asegurar(74);
  const hoja = m.hoja;
  const y = m.cursor;
  const ancho = (ANCHO_UTIL - 3 * 10) / 4;

  const tarjetas: { rotulo: string; valor: Centavos; pie: string }[] = [
    {
      rotulo: "Venta del mes",
      valor: estado.ventas.total,
      pie: `${estado.ventas.cuentas} cuentas cobradas`,
    },
    {
      rotulo: "Gastos del mes",
      valor: estado.total_gastos,
      pie: `${estado.gastos.length} categorías`,
    },
    {
      rotulo: "Resultado",
      valor: estado.resultado.resultado,
      pie: `Food cost ${porcentaje(estado.resultado.food_cost)}`,
    },
    {
      rotulo: "Dinero al cierre",
      valor: estado.flujo.final.total,
      pie: `Efectivo ${importe(estado.flujo.final.efectivo)}`,
    },
  ];

  tarjetas.forEach((t, i) => {
    const x = MARGEN + i * (ancho + 10);
    hoja.rectangulo(x, y, ancho, 60, 0.96);
    // El filo de color solo en la primera y en la del resultado: si todas lo
    // llevaran dejaría de señalar nada.
    hoja.rectangulo(x, y, 2.5, 60, i === 2 ? VERDE : 0.8);

    hoja.texto(x + 9, y + 16, t.rotulo, { tamano: 7.5, gris: 0.45 });
    hoja.texto(x + 9, y + 36, importe(t.valor), { fuente: "cifra-negrita", tamano: 12 });
    hoja.texto(x + 9, y + 51, recortar(t.pie, "normal", 7, ancho - 18), {
      tamano: 7,
      gris: 0.5,
    });
  });

  m.avanzar(74);
}

function seccionIngresos(m: Maqueta, estado: EstadoFinanciero): void {
  const v = estado.ventas;
  m.titulo("Ingresos", "Lo que se vendió en el mes, con el IVA separado para el contador.");

  m.renglon("Venta cobrada (con IVA)", v.total, { fuerte: true });
  m.renglon("Subtotal (sin IVA)", v.subtotal, { sangria: 12 });
  m.renglon("IVA trasladado", v.iva, { sangria: 12 });
  if (v.ieps > 0) m.renglon("IEPS", v.ieps, { sangria: 12 });
  m.separador();

  if (v.descuentos > 0) m.renglon("Descuentos aplicados", v.descuentos, { sangria: 12 });
  if (v.cortesias > 0) m.renglon("Cortesías", v.cortesias, { sangria: 12 });
  m.renglon("Propinas del personal", v.propinas, {
    sangria: 12,
    nota: "no son ingreso del negocio",
  });

  m.espacio(8);
  m.renglon("Cómo se cobró", "", { fuerte: true });
  for (const forma of v.por_forma_pago) {
    m.renglon(forma.etiqueta, forma.importe, {
      sangria: 12,
      nota: `${forma.cuentas} ${forma.cuentas === 1 ? "operación" : "operaciones"}`,
    });
  }

  if (v.cfdi_timbrados > 0 || v.sin_facturar > 0) {
    m.espacio(8);
    m.renglon("Comprobantes fiscales", "", { fuerte: true });
    m.renglon("Facturado y timbrado", v.cfdi_total, {
      sangria: 12,
      nota: `${v.cfdi_timbrados} CFDI`,
    });
    m.renglon("Venta sin facturar", v.sin_facturar, {
      sangria: 12,
      nota: "base de la factura global",
    });
    if (v.cfdi_cancelados > 0) {
      m.renglon("CFDI cancelados", String(v.cfdi_cancelados), { sangria: 12 });
    }
  }

  m.espacio();
}

/** Los gastos, categoría por categoría y renglón por renglón. */
function seccionGastos(m: Maqueta, estado: EstadoFinanciero): void {
  m.titulo(
    "Gastos desglosados",
    "Cada salida del mes, agrupada por categoría y detallada renglón por renglón.",
  );

  if (estado.gastos.length === 0) {
    m.nota("No se registró ningún gasto en el mes.");
    m.espacio();
    return;
  }

  for (const bloque of estado.gastos) detalleDeCategoria(m, bloque);

  m.separador();
  m.renglon("Total de gastos del mes", estado.total_gastos, { fuerte: true });

  if (estado.documentos_por_pagar > 0) {
    m.nota(
      `De estos, ${estado.documentos_por_pagar} documento(s) siguen sin pagarse: ` +
        `${importe(estado.por_pagar)} en cuentas por pagar.`,
    );
  }
  m.espacio();
}

function detalleDeCategoria(m: Maqueta, bloque: BloqueGastos): void {
  m.espacio(6);
  m.renglon(bloque.nombre, bloque.total, {
    fuerte: true,
    nota: bloque.afectaResultado ? undefined : "no resta a la utilidad",
  });

  for (const r of bloque.renglones) {
    const quien = r.proveedor ? ` · ${r.proveedor}` : "";
    m.renglon(`${fechaCorta(r.ts)}  ${r.concepto}${quien}`, r.monto, {
      sangria: 14,
      nota: r.pagado ? r.forma_pago : "PENDIENTE DE PAGO",
    });
  }
}

/**
 * El resultado, con la advertencia de las compras impresa.
 *
 * Sin ese párrafo, un dueño que ve «compras 48 000» arriba y no las encuentra
 * restadas abajo concluye que el informe está mal. Está bien: el queso comprado
 * es inventario hasta que se vende, y su costo ya viene por las recetas.
 */
function seccionResultado(m: Maqueta, estado: EstadoFinanciero): void {
  const r = estado.resultado;
  m.titulo("Resultado del mes", "¿Ganó dinero el negocio? Ingreso menos costo menos gastos.");

  m.renglon("Ingreso (venta sin IVA)", r.ingreso);
  m.renglon("Costo de lo vendido", -r.costo as Centavos, {
    nota: `food cost ${porcentaje(r.food_cost)}`,
  });
  m.separador();
  m.renglon("Margen bruto", r.margen_bruto, { fuerte: true });
  m.espacio(6);

  for (const c of r.por_categoria.filter((c) => c.afectaResultado)) {
    m.renglon(c.nombre, -c.monto as Centavos, { sangria: 12 });
  }
  m.separador();
  m.renglon("Gastos operativos", -r.egresos_operativos as Centavos, { fuerte: true });
  m.espacio(6);
  m.renglon("RESULTADO DEL MES", r.resultado, { fuerte: true });

  if (r.compras > 0) {
    m.espacio(6);
    m.nota(
      `Las compras de insumos del mes (${importe(r.compras)}) NO se restan aquí: son ` +
        "mercancía que se vuelve costo al venderse, y ese costo ya está arriba, en el",
    );
    m.nota(
      "costo de lo vendido. Restarlas otra vez pondría en pérdida cualquier mes de " +
        "surtido. Sí salieron de la caja, y por eso aparecen en el movimiento del dinero.",
    );
  }
  m.espacio();
}

function seccionFlujo(m: Maqueta, estado: EstadoFinanciero): void {
  const f = estado.flujo;
  m.titulo(
    "Movimiento del dinero",
    "Cuánto había, cuánto entró, cuánto salió y con cuánto se cerró el mes.",
  );

  m.renglon("Con lo que empezó el mes", f.inicial.total, { fuerte: true });
  m.renglon("Efectivo", f.inicial.efectivo, { sangria: 12 });
  m.renglon("Banco", f.inicial.banco, { sangria: 12 });
  m.espacio(8);

  m.renglon("Entró", f.entradas);
  m.renglon("Salió", -f.salidas as Centavos);
  m.separador();
  m.renglon("Diferencia del mes", f.neto, { fuerte: true });
  m.espacio(8);

  m.renglon("Con lo que cerró el mes", f.final.total, { fuerte: true });
  m.renglon("Efectivo en el restaurante", f.final.efectivo, { sangria: 12 });
  m.renglon("Banco", f.final.banco, { sangria: 12 });

  m.espacio(6);
  m.nota(
    "El resultado y el dinero no son el mismo número, y los dos son correctos: se " +
      "puede ganar dinero y tener menos en la caja si se surtió la despensa.",
  );
  m.espacio();
}

/** Los cortes de caja del mes y su diferencia acumulada. */
function seccionCortes(m: Maqueta, estado: EstadoFinanciero): void {
  const c = estado.cortes;
  if (c.turnos === 0) return;

  m.titulo("Cortes de caja", "Lo que los cajeros contaron contra lo que debía haber.");
  m.renglon("Turnos del mes", String(c.turnos));
  if (c.turnos_abiertos > 0) {
    m.renglon("Turnos sin cerrar", String(c.turnos_abiertos), {
      nota: "sus cifras aún se mueven",
    });
  }
  m.renglon("Efectivo esperado", c.esperado, { sangria: 12 });
  m.renglon("Efectivo contado", c.declarado, { sangria: 12 });
  m.separador();
  m.renglon(c.diferencia < 0 ? "Faltante acumulado" : "Sobrante acumulado", c.diferencia, {
    fuerte: true,
  });
  m.espacio();
}

/**
 * Todos los movimientos, uno por uno.
 *
 * Es lo que Gonzalo pidió con «todo tipo de movimiento económico que hubo
 * durante el mes», y es lo que convierte el informe en algo verificable: cada
 * cifra de arriba se puede rastrear hasta un renglón de esta lista.
 */
function seccionMovimientos(m: Maqueta, movimientos: readonly RenglonConSaldo[]): void {
  m.titulo(
    "Todos los movimientos del mes",
    "El detalle completo. Cada peso de las cifras anteriores sale de algún renglón de aquí.",
  );

  if (movimientos.length === 0) {
    m.nota("No hubo movimientos de dinero en el mes.");
    return;
  }

  encabezadoDeTabla(m);

  let ultimoDia = "";
  for (const mov of movimientos) {
    const dia = fechaCorta(mov.ts);
    m.asegurar(14);

    // El día solo se escribe cuando cambia: repetirlo en cada renglón convierte
    // la columna en ruido y esconde justo el salto de jornada.
    const hoja = m.hoja;
    const y = m.cursor;

    if (dia !== ultimoDia) {
      hoja.texto(MARGEN, y + 9, dia, { fuente: "cifra", tamano: 8, gris: 0.4 });
      ultimoDia = dia;
    }

    hoja.texto(MARGEN + 34, y + 9, recortar(mov.concepto, "normal", 8.5, 268), {
      tamano: 8.5,
      gris: 0.15,
    });
    hoja.texto(MARGEN + 306, y + 9, mov.cuenta === "efectivo" ? "Efectivo" : "Banco", {
      tamano: 8,
      gris: 0.5,
    });
    hoja.texto(DERECHA - 78, y + 9, importe(mov.monto), {
      fuente: "cifra",
      tamano: 8.5,
      gris: mov.monto < 0 ? 0.35 : 0.1,
      alineacion: "derecha",
    });
    hoja.texto(DERECHA, y + 9, importe(mov.saldo), {
      fuente: "cifra",
      tamano: 8.5,
      gris: 0.45,
      alineacion: "derecha",
    });
    m.avanzar(13);

    // La justificación de un ajuste va debajo, completa: es el dato por el que
    // existe el ajuste, y recortarlo lo dejaría sin servir para nada.
    if (mov.justificacion) {
      m.asegurar(12);
      m.hoja.texto(MARGEN + 34, m.cursor + 8, `· ${mov.justificacion}`, {
        tamano: 7.5,
        gris: 0.5,
      });
      m.avanzar(11);
    }
  }
}

function encabezadoDeTabla(m: Maqueta): void {
  m.asegurar(20);
  const hoja = m.hoja;
  const y = m.cursor;
  const rotulo = { tamano: 7, gris: 0.45 } as const;

  hoja.texto(MARGEN, y + 8, "FECHA", rotulo);
  hoja.texto(MARGEN + 34, y + 8, "CONCEPTO", rotulo);
  hoja.texto(MARGEN + 306, y + 8, "CUENTA", rotulo);
  hoja.texto(DERECHA - 78, y + 8, "IMPORTE", { ...rotulo, alineacion: "derecha" });
  hoja.texto(DERECHA, y + 8, "SALDO", { ...rotulo, alineacion: "derecha" });
  hoja.linea(MARGEN, y + 12, DERECHA, 0.5, 0.75);
  m.avanzar(18);
}

// --- La entrada pública -----------------------------------------------------------------------

/**
 * Arma el PDF del estado financiero y devuelve sus bytes.
 *
 * Recibe el estado ya calculado por el dominio: aquí no se suma nada. Si esta
 * función hiciera aritmética, el papel podría discrepar de la pantalla y no
 * habría forma de saber cuál de los dos miente.
 */
export function estadoFinancieroPdf(estado: EstadoFinanciero): Uint8Array {
  const doc = new DocumentoPdf(
    `Estado financiero ${nombreDelPeriodo(estado.desde)} · ${estado.local}`,
  );
  const m = new Maqueta(doc, estado);

  tarjetasResumen(m, estado);
  m.espacio(10);
  seccionIngresos(m, estado);
  seccionGastos(m, estado);
  seccionResultado(m, estado);
  seccionFlujo(m, estado);
  seccionCortes(m, estado);
  seccionMovimientos(m, estado.flujo.movimientos);

  return doc.bytes();
}

/** Nombre de archivo sugerido: `estado-financiero-2026-09-rodizio.pdf`. */
export function nombreArchivoEstado(estado: EstadoFinanciero): string {
  const d = new Date(estado.desde);
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const local = estado.local
    .toLowerCase()
    .normalize("NFD")
    .replace(/[0300-036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `estado-financiero-${mes}${local ? `-${local}` : ""}.pdf`;
}
