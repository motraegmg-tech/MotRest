/**
 * El estado financiero del mes, dibujado en una hoja carta.
 *
 * ## A quién se lo va a dar el restaurantero
 *
 * A tres personas, y por eso el orden de las secciones es el que es:
 *
 * - **A sí mismo**, para saber cómo fue el mes: por eso lo primero son cinco
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
 *
 * Y el resultado trae DOS utilidades (sep-2026): la contable, donde los
 * insumos pesan al venderse, y la de efectivo, donde pesan al comprarse. Van
 * con el mismo nombre que en la pantalla del día y la del mes —los nombres
 * vienen del dominio, no se teclean aquí— y con la línea que dice en qué se
 * diferencian.
 */
import {
  DIFERENCIA_ENTRE_UTILIDADES,
  UTILIDAD_CONTABLE,
  UTILIDAD_EN_EFECTIVO,
  type BloqueGastos,
  type Centavos,
  type EstadoFinanciero,
  type RenglonConSaldo,
} from "@motrest/dominio";
import { CARTA, DocumentoPdf, Pagina, anchoDeTexto, recortar, type Fuente } from "./pdf.js";

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

/**
 * Parte un texto en renglones que quepan en un ancho, sin cortar palabras.
 *
 * La maqueta escribe donde se le dice y no reparte texto: las notas largas se
 * partían a mano, y un párrafo que se alarga —con un importe de siete cifras,
 * por ejemplo— se salía del papel sin que nada fallara. Se mide con la misma
 * tabla de anchos que usa `recortar`.
 */
export function partirEnRenglones(
  texto: string,
  fuente: Fuente,
  tamano: number,
  ancho: number,
): string[] {
  const renglones: string[] = [];
  let actual = "";

  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const propuesta = actual ? `${actual} ${palabra}` : palabra;
    if (actual && anchoDeTexto(propuesta, fuente, tamano) > ancho) {
      renglones.push(actual);
      actual = palabra;
    } else {
      actual = propuesta;
    }
  }
  if (actual) renglones.push(actual);

  // Una sola palabra más ancha que la hoja no tiene dónde partirse: se recorta.
  return renglones.map((r) => recortar(r, fuente, tamano, ancho));
}

/**
 * El tamaño mayor —hasta 12 pt— con el que una cifra cabe en su tarjeta.
 *
 * Con cinco tarjetas en el ancho de la hoja, «-$1,234,567.89» a 12 pt se
 * saldría de la suya y se montaría sobre la de al lado. Un restaurante que
 * vende siete cifras al mes existe; bajar el tamaño solo cuando hace falta
 * deja las cifras normales tan grandes como antes.
 */
function tamanoQueCabe(texto: string, ancho: number): number {
  for (let tamano = 12; tamano > 7; tamano -= 0.5) {
    if (anchoDeTexto(texto, "cifra-negrita", tamano) <= ancho) return tamano;
  }
  return 7;
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
      /*
       * El aviso se repite en cada hoja: un informe se fotocopia, se manda por
       * partes y se archiva suelto. La página 4 tiene que poder defenderse sola.
       */
      const rotulo = `Estado financiero · ${nombreDelPeriodo(this.estado.desde)}`;
      pagina.texto(DERECHA, 44, this.estado.periodo_incompleto ? `${rotulo} · INCOMPLETO` : rotulo, {
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

  /** Una nota larga, partida en renglones que caben en la hoja. */
  parrafo(texto: string): void {
    for (const renglon of partirEnRenglones(texto, "normal", 7.5, ANCHO_UTIL)) {
      this.nota(renglon);
    }
  }
}

// --- Las secciones ---------------------------------------------------------------------------

/**
 * El aviso de que a este período le falta historial.
 *
 * ## Por qué es lo primero que se ve
 *
 * La retención borra del disco las cuentas más viejas que el plazo elegido. Un
 * informe de un mes ya retirado no sale con error: sale con números pequeños,
 * que es mucho peor, porque se puede firmar y entregar sin que nadie sospeche.
 * Va arriba del todo y antes de las cifras, porque un aviso al pie lo lee quien
 * ya tomó la decisión.
 *
 * El dinero al cierre SÍ es correcto —lo sostiene el arrastre— y el papel lo
 * dice, para que nadie intente «arreglar» un saldo que está bien.
 */
function avisoDeHistorialRetirado(m: Maqueta, estado: EstadoFinanciero): void {
  if (!estado.periodo_incompleto) return;

  const alto = 68;
  m.asegurar(alto + 10);
  const hoja = m.hoja;
  const y = m.cursor;

  hoja.rectangulo(MARGEN, y, ANCHO_UTIL, alto, 0.93);
  hoja.rectangulo(MARGEN, y, 3, alto, 0.45);

  hoja.texto(MARGEN + 12, y + 17, "Informe incompleto: a este período le falta historial", {
    fuente: "negrita",
    tamano: 9.5,
  });
  /*
   * Los renglones van partidos a mano y medidos —ver la prueba— porque la
   * maqueta no reparte texto: escribe donde se le dice. Una línea de más se
   * saldría del papel sin avisar.
   */
  const renglones = [
    `Las cuentas anteriores al ${fechaLarga(estado.historial_retirado_hasta)} se retiraron de esta`,
    "computadora por la política de retención elegida. La venta y los gastos de abajo son",
    "solo los que siguen guardados. El dinero al cierre sí es correcto.",
  ];
  renglones.forEach((linea, i) => {
    hoja.texto(MARGEN + 12, y + 31 + i * 12, linea, { tamano: 8, gris: 0.3 });
  });

  m.avanzar(alto + 10);
}

/**
 * Las cinco cifras de arriba.
 *
 * Es lo único que mucha gente va a mirar, así que son las que de verdad
 * resumen un mes: lo que se vendió, lo que se gastó, si se ganó —contado de
 * las dos formas— y con cuánto dinero se cerró.
 *
 * Las dos utilidades van juntas y con el pie que dice cuándo pesan los
 * insumos: es la diferencia entera entre ellas, y en el papel no hay nadie al
 * lado para explicarla.
 */
function tarjetasResumen(m: Maqueta, estado: EstadoFinanciero): void {
  m.asegurar(74);
  const hoja = m.hoja;
  const y = m.cursor;

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
      rotulo: UTILIDAD_CONTABLE,
      valor: estado.resultado.resultado,
      pie: "Insumos al venderse",
    },
    {
      rotulo: UTILIDAD_EN_EFECTIVO,
      valor: estado.resultado.utilidad_efectivo,
      pie: "Insumos al comprarse",
    },
    {
      rotulo: "Dinero al cierre",
      valor: estado.flujo.final.total,
      pie: `Efectivo ${importe(estado.flujo.final.efectivo)}`,
    },
  ];

  const separacion = 8;
  const ancho = (ANCHO_UTIL - (tarjetas.length - 1) * separacion) / tarjetas.length;
  const util = ancho - 18;

  tarjetas.forEach((t, i) => {
    const x = MARGEN + i * (ancho + separacion);
    hoja.rectangulo(x, y, ancho, 60, 0.96);
    // El filo de color solo en la utilidad contable, que es la que decide
    // precios: si todas lo llevaran dejaría de señalar nada.
    hoja.rectangulo(x, y, 2.5, 60, i === 2 ? VERDE : 0.8);

    const cifra = importe(t.valor);
    hoja.texto(x + 9, y + 16, recortar(t.rotulo, "normal", 7.5, util), { tamano: 7.5, gris: 0.45 });
    hoja.texto(x + 9, y + 36, cifra, {
      fuente: "cifra-negrita",
      tamano: tamanoQueCabe(cifra, util),
    });
    hoja.texto(x + 9, y + 51, recortar(t.pie, "normal", 7, util), {
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
  // El consumo de socios va junto a las propinas y por el mismo motivo: entró al
  // local pero no es ingreso del negocio. Desde la 1.5.6 tampoco está dentro de
  // la venta de arriba, así que sin este renglón el contador no encontraría por
  // qué el corte trae más dinero del que dice la venta.
  if ((v.consumo_socios ?? 0) > 0) {
    m.renglon("Consumo de socios", v.consumo_socios, {
      sangria: 12,
      nota: "no es venta: lo cubrió su bolsa",
    });
  }

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

  const enGlobal = v.global_facturado ?? (0 as Centavos);
  if (v.cfdi_timbrados > 0 || v.sin_facturar > 0 || enGlobal > 0) {
    m.espacio(8);
    m.renglon("Comprobantes fiscales", "", { fuerte: true });
    m.renglon("Facturado y timbrado", v.cfdi_total, {
      sangria: 12,
      nota: `${v.cfdi_timbrados} CFDI`,
    });
    // Desde la 1.5.5 el Hub emite sola la global del mes con FacturAPI: lo que
    // entró ahí ya está facturado y no puede seguir leyéndose como pendiente.
    if (enGlobal > 0) {
      m.renglon("Incluido en la factura global", enGlobal, {
        sangria: 12,
        nota: "público en general",
      });
    }
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
    // «a la utilidad» a secas ya no es cierto: la de efectivo sí la resta.
    nota: bloque.afectaResultado ? undefined : "no resta a la utilidad contable",
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
 * El resultado: las dos utilidades, cada una con su cuenta a la vista.
 *
 * Primero la contable —la de siempre, la que decide precios— y debajo la de
 * efectivo, que pidió Gonzalo para ver la compra de insumos restada. Cada una
 * lleva sus renglones: dos cifras sin la cuenta que las produce solo invitan a
 * pensar que una está mal.
 *
 * La advertencia de las compras sigue impresa. Sin ella, un dueño que ve
 * «compras 48 000» en los gastos y no las encuentra restadas en la contable
 * concluye que el informe está mal. Está bien: el queso comprado es inventario
 * hasta que se vende, y su costo ya viene por las recetas.
 *
 * Las cifras vienen hechas del dominio; aquí no se resta nada, ni siquiera la
 * diferencia entre las dos. Ver `estadoFinancieroPdf`.
 */
function seccionResultado(m: Maqueta, estado: EstadoFinanciero): void {
  const r = estado.resultado;
  m.titulo(
    "Resultado del mes",
    "¿Ganó dinero el negocio? Se contesta de dos formas, y las dos son correctas.",
  );

  // --- La contable: los insumos pesan cuando se venden.
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
  m.renglon(UTILIDAD_CONTABLE, r.resultado, { fuerte: true, nota: "insumos al venderse" });

  // --- La de efectivo: los insumos pesan cuando se compran, y el costo no.
  m.espacio(12);
  m.renglon("Ingreso (venta sin IVA)", r.ingreso);
  m.renglon("Gastos operativos", -r.egresos_operativos as Centavos);
  m.renglon("Compra de insumos", -r.compras as Centavos);
  m.separador();
  m.renglon(UTILIDAD_EN_EFECTIVO, r.utilidad_efectivo, {
    fuerte: true,
    nota: "insumos al comprarse",
  });

  m.espacio(6);
  m.parrafo(DIFERENCIA_ENTRE_UTILIDADES);
  if (r.compras > 0) {
    m.parrafo(
      `Las compras de insumos del mes (${importe(r.compras)}) NO se restan a la ` +
        "utilidad contable: son mercancía que se vuelve costo al venderse, y ese costo " +
        `ya está arriba, en el costo de lo vendido (${importe(r.costo)}). La utilidad ` +
        "en efectivo hace lo contrario —resta la compra y no el costo—, así que ninguna " +
        "de las dos cuenta el mismo insumo dos veces.",
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
  /*
   * Con la utilidad en efectivo en el papel, esta es la confusión nueva que hay
   * que atajar: «si ya dice cuánto quedó en efectivo, ¿por qué esta diferencia
   * es otra?». Se dice por qué, con las tres razones que la separan.
   */
  m.parrafo(
    "Las utilidades y el dinero no son el mismo número, y todos son correctos: se " +
      "puede ganar dinero y tener menos en la caja si se surtió la despensa. Aquí " +
      "entra lo cobrado con IVA y con propinas, y lo comprado a crédito sale el día " +
      "que se paga; la utilidad en efectivo parte de la venta sin IVA y resta cada " +
      "gasto en el mes en que se registró.",
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

  avisoDeHistorialRetirado(m, estado);
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
    /*
     * Las marcas de acento que deja `normalize("NFD")`. Estaba escrito como
     * `[0300-036f]`, sin las `\u`: en vez de los acentos quitaba los dígitos 0,
     * 3 y 6 y la letra f, y «La Fonda 360» salía como «la-onda».
     */
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `estado-financiero-${mes}${local ? `-${local}` : ""}.pdf`;
}
