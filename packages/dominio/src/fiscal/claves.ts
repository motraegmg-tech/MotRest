/**
 * Catálogos del SAT necesarios para CFDI 4.0 en un restaurante.
 *
 * Se incluye el subconjunto que un restaurante usa de verdad, no el catálogo
 * completo (que tiene decenas de miles de claves). Ampliarlo es agregar filas.
 */

export interface ClaveSat {
  clave: string;
  descripcion: string;
}

/** Régimen fiscal del contribuyente (catálogo c_RegimenFiscal). */
export const REGIMENES_FISCALES: ClaveSat[] = [
  { clave: "601", descripcion: "General de Ley Personas Morales" },
  { clave: "603", descripcion: "Personas Morales con Fines no Lucrativos" },
  { clave: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { clave: "606", descripcion: "Arrendamiento" },
  { clave: "607", descripcion: "Régimen de Enajenación o Adquisición de Bienes" },
  { clave: "608", descripcion: "Demás ingresos" },
  { clave: "610", descripcion: "Residentes en el Extranjero sin Establecimiento Permanente" },
  { clave: "611", descripcion: "Ingresos por Dividendos (socios y accionistas)" },
  { clave: "612", descripcion: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave: "614", descripcion: "Ingresos por intereses" },
  { clave: "615", descripcion: "Régimen de los ingresos por obtención de premios" },
  { clave: "616", descripcion: "Sin obligaciones fiscales" },
  { clave: "620", descripcion: "Sociedades Cooperativas de Producción" },
  { clave: "621", descripcion: "Incorporación Fiscal" },
  { clave: "622", descripcion: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { clave: "623", descripcion: "Opcional para Grupos de Sociedades" },
  { clave: "624", descripcion: "Coordinados" },
  { clave: "625", descripcion: "Régimen de Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { clave: "626", descripcion: "Régimen Simplificado de Confianza" },
];

/** Uso que el receptor le dará al comprobante (catálogo c_UsoCFDI). */
export const USOS_CFDI: ClaveSat[] = [
  { clave: "G01", descripcion: "Adquisición de mercancías" },
  { clave: "G03", descripcion: "Gastos en general" },
  { clave: "D01", descripcion: "Honorarios médicos, dentales y gastos hospitalarios" },
  { clave: "D10", descripcion: "Pagos por servicios educativos (colegiaturas)" },
  { clave: "I01", descripcion: "Construcciones" },
  { clave: "I04", descripcion: "Equipo de computo y accesorios" },
  { clave: "S01", descripcion: "Sin efectos fiscales" },
  { clave: "CP01", descripcion: "Pagos" },
];

/** Forma en que se recibió el pago (catálogo c_FormaPago). */
export const FORMAS_PAGO_SAT: ClaveSat[] = [
  { clave: "01", descripcion: "Efectivo" },
  { clave: "02", descripcion: "Cheque nominativo" },
  { clave: "03", descripcion: "Transferencia electrónica de fondos" },
  { clave: "04", descripcion: "Tarjeta de crédito" },
  { clave: "28", descripcion: "Tarjeta de débito" },
  { clave: "29", descripcion: "Tarjeta de servicios" },
  { clave: "30", descripcion: "Aplicación de anticipos" },
  { clave: "99", descripcion: "Por definir" },
];

/** Método de pago (catálogo c_MetodoPago). */
export const METODOS_PAGO: ClaveSat[] = [
  { clave: "PUE", descripcion: "Pago en una sola exhibición" },
  { clave: "PPD", descripcion: "Pago en parcialidades o diferido" },
];

/** Clave de producto o servicio por omisión para consumo en restaurante. */
export const CLAVE_PRODSERV_RESTAURANTE = "90101501";

/** Unidad de medida: "Unidad de servicio". */
export const CLAVE_UNIDAD_SERVICIO = "E48";

/** Impuestos federales (catálogo c_Impuesto). */
export const IMPUESTO_IVA = "002";
export const IMPUESTO_IEPS = "003";

/** Objeto de impuesto (catálogo c_ObjetoImp). */
export const OBJETO_IMPUESTO_SI = "02";
export const OBJETO_IMPUESTO_NO = "01";

/** RFC genérico para ventas al público en general. */
export const RFC_PUBLICO_GENERAL = "XAXX010101000";
/** RFC genérico para residentes en el extranjero. */
export const RFC_EXTRANJERO = "XEXX010101000";

/** Receptor por omisión del ticket sin datos fiscales. */
export const RECEPTOR_PUBLICO_GENERAL = {
  rfc: RFC_PUBLICO_GENERAL,
  nombre: "PUBLICO EN GENERAL",
  regimen_fiscal: "616",
  codigo_postal: "",
  uso_cfdi: "S01",
} as const;

export function descripcionDe(catalogo: ClaveSat[], clave: string): string {
  return catalogo.find((c) => c.clave === clave)?.descripcion ?? clave;
}

/**
 * Motivos de cancelación del SAT (catálogo c_MotivoCancelacion).
 *
 * No es texto libre: el SAT solo acepta estos cuatro códigos, y el `01` tiene
 * una regla propia —exige el folio fiscal del comprobante que lo sustituye—.
 * Elegir mal el motivo hace que el SAT rechace la cancelación.
 */
export const MOTIVOS_CANCELACION: ClaveSat[] = [
  { clave: "01", descripcion: "Comprobante emitido con errores con relación" },
  { clave: "02", descripcion: "Comprobante emitido con errores sin relación" },
  { clave: "03", descripcion: "No se llevó a cabo la operación" },
  { clave: "04", descripcion: "Operación nominativa relacionada en una factura global" },
];

/**
 * El motivo `01` obliga a indicar el UUID del comprobante que sustituye al que
 * se cancela: se emitió con un error y el nuevo es la corrección. Los demás
 * motivos NO llevan sustitución, y ponérsela también hace que el SAT rechace.
 */
export function motivoRequiereSustitucion(codigo: string): boolean {
  return codigo === "01";
}
