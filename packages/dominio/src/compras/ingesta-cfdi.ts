/**
 * Ingesta de la factura XML del proveedor (F2).
 *
 * En México todo proveedor formal entrega un CFDI en XML. Hoy alguien lo abre,
 * lee los renglones y los teclea a mano en la orden de compra: media hora por
 * factura y una oportunidad de error en cada cifra. Aquí se lee el archivo y se
 * propone la recepción ya capturada.
 *
 * DOS REGLAS QUE GOBIERNAN EL DISEÑO
 *
 * 1. **Leer NO es dar por buena.** Esta función no registra nada: interpreta el
 *    XML y devuelve lo que propondría, concepto por concepto, para que alguien
 *    lo revise contra la mercancía que tiene enfrente. Un proveedor factura lo
 *    que despachó, no siempre lo que llegó.
 *
 * 2. **Los conceptos del proveedor NO son los insumos del restaurante.** Él
 *    vende «QUESO MOZZARELLA BOLA 5KG» y el almacén lleva «Mozzarella» en
 *    gramos. Esa correspondencia la enseña una persona una vez; el software la
 *    propone y la recuerda, pero no la inventa. Adivinar aquí es meter cantidades
 *    equivocadas al inventario, que es peor que no meter ninguna.
 *
 * Se lee por expresión regular sobre los atributos, igual que `leerTimbre`: un
 * CFDI de compra es un documento plano y no justifica traer un analizador de XML
 * entero al Hub de un restaurante.
 */
import { deCentavos, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

/** Un renglón tal como viene en la factura del proveedor. */
export interface ConceptoProveedor {
  /** Clave del producto del proveedor, si la trae. Es la mejor llave de mapeo. */
  clave?: string;
  descripcion: string;
  cantidad: number;
  /** Unidad como la nombra el proveedor: KGM, PZA, LTR… */
  unidad?: string;
  valor_unitario: Centavos;
  importe: Centavos;
}

/** Lo que se pudo leer de una factura de proveedor. */
export interface FacturaProveedor {
  /** UUID del timbre. Es lo que permite no ingerir dos veces la misma factura. */
  uuid?: string;
  serie?: string;
  folio?: string;
  fecha?: string;
  emisor_rfc: string;
  emisor_nombre: string;
  receptor_rfc: string;
  subtotal: Centavos;
  total: Centavos;
  conceptos: ConceptoProveedor[];
}

export type ProblemaIngesta =
  | "no_es_cfdi"
  | "sin_emisor"
  | "sin_conceptos"
  | "no_es_para_este_rfc";

export interface ResultadoIngesta {
  ok: boolean;
  factura?: FacturaProveedor;
  problema?: ProblemaIngesta;
  detalle?: string;
}

/** Importe del XML —en pesos con decimales— a centavos exactos. */
function aCentavos(texto: string): Centavos {
  const valor = Number(texto);
  return deCentavos(Number.isFinite(valor) ? Math.round(valor * 100) : 0);
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Lee un atributo de un bloque de atributos XML. */
function atributo(bloque: string, nombre: string): string {
  const encontrado = new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`, "i").exec(bloque);
  return encontrado ? desescapar(encontrado[1]!) : "";
}

/**
 * Interpreta el XML de una factura de proveedor.
 *
 * @param xml El archivo tal cual.
 * @param rfcPropio RFC del restaurante. Si se pasa, se comprueba que la factura
 *   venga a su nombre: ingerir la factura de otro contribuyente metería compras
 *   ajenas al inventario y al gasto.
 */
export function leerFacturaProveedor(xml: string, rfcPropio?: string): ResultadoIngesta {
  const comprobante = /<(?:cfdi:)?Comprobante\b([^>]*)>/i.exec(xml);
  if (!comprobante) {
    return { ok: false, problema: "no_es_cfdi", detalle: "El archivo no es un CFDI" };
  }
  const cab = comprobante[1]!;

  const emisorBloque = /<(?:cfdi:)?Emisor\b([^>]*)\/?>/i.exec(xml);
  const receptorBloque = /<(?:cfdi:)?Receptor\b([^>]*)\/?>/i.exec(xml);
  if (!emisorBloque) {
    return { ok: false, problema: "sin_emisor", detalle: "La factura no dice quién la emite" };
  }

  const emisor_rfc = atributo(emisorBloque[1]!, "Rfc").toUpperCase();
  const receptor_rfc = receptorBloque
    ? atributo(receptorBloque[1]!, "Rfc").toUpperCase()
    : "";

  if (rfcPropio && receptor_rfc && receptor_rfc !== rfcPropio.trim().toUpperCase()) {
    return {
      ok: false,
      problema: "no_es_para_este_rfc",
      detalle: `La factura está a nombre de ${receptor_rfc}, no del restaurante`,
    };
  }

  // Conceptos: se aceptan tanto la forma con cierre propio como la que envuelve
  // impuestos, porque ambas son válidas y los PAC emiten de las dos maneras.
  const conceptos: ConceptoProveedor[] = [];
  const patron = /<(?:cfdi:)?Concepto\b([^>]*?)\/?>/gi;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = patron.exec(xml)) !== null) {
    const c = encontrado[1]!;
    const descripcion = atributo(c, "Descripcion");
    if (descripcion === "") continue;

    const cantidad = Number(atributo(c, "Cantidad"));
    conceptos.push({
      clave: atributo(c, "NoIdentificacion") || undefined,
      descripcion,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      unidad: atributo(c, "Unidad") || atributo(c, "ClaveUnidad") || undefined,
      valor_unitario: aCentavos(atributo(c, "ValorUnitario")),
      importe: aCentavos(atributo(c, "Importe")),
    });
  }

  if (conceptos.length === 0) {
    return {
      ok: false,
      problema: "sin_conceptos",
      detalle: "La factura no trae renglones que se puedan capturar",
    };
  }

  const timbre = /<tfd:TimbreFiscalDigital\b([^>]*)\/?>/i.exec(xml);

  return {
    ok: true,
    factura: {
      uuid: timbre ? atributo(timbre[1]!, "UUID") || undefined : undefined,
      serie: atributo(cab, "Serie") || undefined,
      folio: atributo(cab, "Folio") || undefined,
      fecha: atributo(cab, "Fecha") || undefined,
      emisor_rfc,
      emisor_nombre: atributo(emisorBloque[1]!, "Nombre"),
      receptor_rfc,
      subtotal: aCentavos(atributo(cab, "SubTotal")),
      total: aCentavos(atributo(cab, "Total")),
      conceptos,
    },
  };
}

// --- De conceptos del proveedor a insumos del almacén ----------------------------------------

/**
 * Lo que el restaurante ya enseñó: qué concepto del proveedor es qué insumo.
 *
 * La llave es el RFC del emisor más su clave de producto —o, si no la trae, su
 * descripción—: dos proveedores distintos pueden llamar igual a cosas distintas.
 */
export interface EquivalenciaInsumo {
  emisor_rfc: string;
  /** Clave o descripción del concepto en la factura del proveedor. */
  clave_proveedor: string;
  insumo_id: ID;
  /**
   * Cuántas unidades base del almacén trae una unidad del proveedor.
   *
   * Es el número que evita el error más caro de esta función: el proveedor
   * factura una BOLSA de 5 kg y el almacén lleva gramos. Sin el factor, entrarían
   * 5 gramos al inventario en vez de 5 000.
   */
  factor: number;
}

/** Con qué llave se recuerda un concepto. */
export function claveDeConcepto(concepto: ConceptoProveedor): string {
  return (concepto.clave ?? concepto.descripcion).trim().toUpperCase();
}

export interface RenglonPropuesto {
  concepto: ConceptoProveedor;
  /** Insumo del almacén, si ya se enseñó la equivalencia. */
  insumo_id?: ID;
  /** Cantidad en la unidad base del almacén. `null` si falta la equivalencia. */
  cantidad_base: number | null;
  /** Costo por unidad base, para actualizar el costeo. */
  costo_unitario: Centavos | null;
  /** true = hay que enseñarle a qué insumo corresponde antes de poder recibir. */
  requiere_mapeo: boolean;
}

/**
 * Propone la recepción a partir de la factura y de lo ya aprendido.
 *
 * Lo que no se sabe se marca `requiere_mapeo` en vez de adivinarse. Un insumo
 * mal identificado mete cantidades equivocadas al inventario y contamina el
 * costeo y el centinela de mermas: es peor que no capturar nada.
 */
export function proponerRecepcion(
  factura: FacturaProveedor,
  equivalencias: readonly EquivalenciaInsumo[],
): RenglonPropuesto[] {
  const porClave = new Map(
    equivalencias
      .filter((e) => e.emisor_rfc.toUpperCase() === factura.emisor_rfc.toUpperCase())
      .map((e) => [e.clave_proveedor.trim().toUpperCase(), e]),
  );

  return factura.conceptos.map((concepto) => {
    const eq = porClave.get(claveDeConcepto(concepto));
    if (!eq || eq.factor <= 0) {
      return { concepto, cantidad_base: null, costo_unitario: null, requiere_mapeo: true };
    }

    const cantidad_base = concepto.cantidad * eq.factor;
    return {
      concepto,
      insumo_id: eq.insumo_id,
      cantidad_base,
      // El costo por unidad BASE: es el que alimenta el costeo del almacén.
      costo_unitario:
        cantidad_base > 0
          ? deCentavos(Math.round(concepto.importe / cantidad_base))
          : deCentavos(0),
      requiere_mapeo: false,
    };
  });
}

/** ¿Esta factura ya se ingirió? Se compara por UUID, que es único ante el SAT. */
export function yaIngerida(uuid: string | undefined, ingeridas: readonly string[]): boolean {
  if (!uuid) return false;
  return ingeridas.some((u) => u.toUpperCase() === uuid.toUpperCase());
}
