/**
 * Varias razones sociales y franquicias (F5).
 *
 * DOS COSAS QUE PARECEN UNA Y NO LO SON:
 *
 *   MULTISUCURSAL — varios locales, UNA empresa. Ya existe (`multisucursal.ts`):
 *   se consolidan cifras y punto.
 *
 *   MULTIEMPRESA — varios locales con RAZONES SOCIALES DISTINTAS. Es lo normal
 *   en México y no es un capricho fiscal: se abre una razón social por local
 *   para acotar riesgos, para repartir con socios distintos, o porque el local
 *   nuevo entró con otro RFC. Cada una **factura por su cuenta, con su propio
 *   CSD**, y sus ventas NO se pueden mezclar en una declaración.
 *
 * DE AHÍ LA REGLA QUE MANDA AQUÍ: **el consolidado es de gestión, no fiscal.**
 * Sumar las ventas de tres razones sociales para que el dueño vea su negocio
 * está bien y es lo que quiere. Presentar esa suma como si fuera de una sola
 * empresa ante el SAT es otra cosa muy distinta, y por eso todo consolidado
 * multiempresa sale marcado y desglosado por RFC.
 *
 * FRANQUICIAS. Un franquiciante impone la carta y cobra regalías sobre la venta
 * de cada franquiciatario. Lo que hace falta es poco y concreto: saber qué
 * productos son del estándar —y por tanto no se tocan—, y calcular la regalía
 * sobre una base que las dos partes entiendan igual.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

/** Una razón social. Factura por su cuenta y tiene su propio CSD. */
export interface Empresa {
  id: ID;
  /** Razón social como está en el SAT. */
  razon_social: string;
  rfc: string;
  /** Nombre corto para las pantallas: "Rodizio Centro SA". */
  nombre_corto: string;
  regimen_fiscal: string;
  activa: boolean;
}

/** El vínculo entre un local y la empresa que lo factura. */
export interface AsignacionLocal {
  sucursal_id: ID;
  empresa_id: ID;
}

export type RelacionFranquicia =
  /** El local es del dueño. No paga regalías. */
  | "propio"
  /** Lo opera un tercero bajo la marca. Paga regalías. */
  | "franquiciado";

export interface Franquicia {
  sucursal_id: ID;
  relacion: RelacionFranquicia;
  /** Quién lo opera, si no es el dueño. */
  franquiciatario?: string;
  /** Fracción de la venta que se paga como regalía (0.05 = 5 %). */
  regalia: number;
  /** Aportación a publicidad, también como fracción. */
  fondo_publicidad?: number;
  /**
   * Mínimo mensual, si el contrato lo tiene.
   *
   * Existe porque los contratos reales lo llevan: el franquiciante no puede
   * depender de que el local venda. Se cobra el mayor entre el porcentaje y esto.
   */
  minimo_mensual?: Centavos;
  desde_ts: number;
}

// --- Multiempresa ---------------------------------------------------------------------------

export interface RenglonPorEmpresa {
  empresa_id: ID;
  razon_social: string;
  rfc: string;
  locales: ID[];
  ventas: Centavos;
  /** IVA trasladado, que es lo que de verdad se declara. */
  impuestos: Centavos;
}

export interface ConsolidadoMultiempresa {
  renglones: RenglonPorEmpresa[];
  /** La suma de todo. **De gestión, NUNCA fiscal.** */
  ventas: Centavos;
  /** true = hay más de un RFC, y entonces el total de arriba no se declara. */
  varias_empresas: boolean;
  /** Lo que hay que enseñar junto al total para que nadie lo malinterprete. */
  advertencia?: string;
}

export interface VentaDeLocal {
  sucursal_id: ID;
  ventas: Centavos;
  impuestos: Centavos;
}

/**
 * Junta las ventas por razón social.
 *
 * El total va acompañado de una advertencia EXPLÍCITA cuando hay más de un RFC.
 * No es una nota legal de relleno: un dueño que ve "$1 200 000 del mes" y se lo
 * pasa a su contador sin decir que son tres empresas provoca una declaración
 * mal armada, y eso se paga con multas.
 */
export function consolidarPorEmpresa(
  empresas: readonly Empresa[],
  asignaciones: readonly AsignacionLocal[],
  ventas: readonly VentaDeLocal[],
): ConsolidadoMultiempresa {
  const empresaDe = new Map(asignaciones.map((a) => [a.sucursal_id, a.empresa_id]));
  const porEmpresa = new Map<ID, RenglonPorEmpresa>();

  for (const empresa of empresas.filter((e) => e.activa)) {
    porEmpresa.set(empresa.id, {
      empresa_id: empresa.id,
      razon_social: empresa.razon_social,
      rfc: empresa.rfc,
      locales: [],
      ventas: CERO,
      impuestos: CERO,
    });
  }

  for (const venta of ventas) {
    const id = empresaDe.get(venta.sucursal_id);
    const renglon = id ? porEmpresa.get(id) : undefined;
    /*
     * Un local SIN empresa asignada se ignora en vez de caer en un cajón de
     * "otros". Meterlo en cualquier RFC es exactamente el error que esta
     * pantalla existe para evitar.
     */
    if (!renglon) continue;

    renglon.locales.push(venta.sucursal_id);
    renglon.ventas = sumar(renglon.ventas, venta.ventas);
    renglon.impuestos = sumar(renglon.impuestos, venta.impuestos);
  }

  const renglones = [...porEmpresa.values()]
    .filter((r) => r.locales.length > 0)
    .sort((a, b) => b.ventas - a.ventas);

  const varias = renglones.length > 1;

  return {
    renglones,
    ventas: sumar(...renglones.map((r) => r.ventas)),
    varias_empresas: varias,
    ...(varias
      ? {
          advertencia:
            `Este total suma ${renglones.length} razones sociales distintas. ` +
            "Sirve para ver el negocio completo, NO para declarar: cada RFC " +
            "presenta lo suyo por separado.",
        }
      : {}),
  };
}

/** Los locales que todavía no tienen razón social asignada. */
export function localesSinEmpresa(
  locales: readonly ID[],
  asignaciones: readonly AsignacionLocal[],
): ID[] {
  const asignados = new Set(asignaciones.map((a) => a.sucursal_id));
  return locales.filter((id) => !asignados.has(id));
}

// --- Franquicias ----------------------------------------------------------------------------

export interface CalculoRegalia {
  sucursal_id: ID;
  /** Sobre qué se calculó. */
  base: Centavos;
  regalia: Centavos;
  publicidad: Centavos;
  total: Centavos;
  /** true = se aplicó el mínimo del contrato en vez del porcentaje. */
  por_minimo: boolean;
}

/**
 * Calcula lo que un franquiciatario debe del periodo.
 *
 * LA BASE ES LA VENTA **SIN IVA**, y esto no es un detalle: el IVA no es del
 * restaurante, es del SAT que pasa por su caja. Cobrar regalías sobre él sería
 * cobrarle al franquiciatario un porcentaje de un dinero que nunca fue suyo — y
 * es la discusión que rompe contratos de franquicia.
 *
 * Se aplica el MAYOR entre el porcentaje y el mínimo del contrato, no la suma.
 * El mínimo existe para que el franquiciante no dependa de que el local venda,
 * no para cobrar dos veces.
 */
export function calcularRegalia(
  franquicia: Franquicia,
  ventaSinIva: Centavos,
): CalculoRegalia {
  if (franquicia.relacion === "propio") {
    return {
      sucursal_id: franquicia.sucursal_id,
      base: ventaSinIva,
      regalia: CERO,
      publicidad: CERO,
      total: CERO,
      por_minimo: false,
    };
  }

  const porPorcentaje = Math.round(ventaSinIva * franquicia.regalia) as Centavos;
  const minimo = franquicia.minimo_mensual ?? CERO;
  const por_minimo = minimo > porPorcentaje;
  const regalia = (por_minimo ? minimo : porPorcentaje) as Centavos;

  const publicidad = Math.round(
    ventaSinIva * (franquicia.fondo_publicidad ?? 0),
  ) as Centavos;

  return {
    sucursal_id: franquicia.sucursal_id,
    base: ventaSinIva,
    regalia,
    publicidad,
    total: sumar(regalia, publicidad),
    por_minimo,
  };
}

/** El catálogo que el franquiciante impone y el franquiciatario no puede tocar. */
export interface ProductoEstandar {
  producto_id: ID;
  /** true = ni el nombre ni la receta se cambian. */
  bloqueado: boolean;
  /** true = tampoco el precio. Muchas franquicias lo dejan libre por plaza. */
  precio_fijo?: boolean;
  precio_sugerido?: Centavos;
}

export type VeredictoEdicion =
  | { puede: true }
  | { puede: false; razon: string };

/**
 * ¿Puede este local cambiar este producto?
 *
 * Se comprueba en el local y no en el corporativo a propósito: un
 * franquiciatario sin internet tiene que poder abrir y operar, y no debe poder
 * cambiar la carta estándar aprovechando que nadie lo ve. La regla viaja con el
 * catálogo.
 */
export function puedeEditarProducto(
  estandar: ProductoEstandar | undefined,
  campo: "nombre" | "receta" | "precio" | "disponibilidad",
): VeredictoEdicion {
  // Lo que no es del estándar es del local: su carta propia no se toca.
  if (!estandar || !estandar.bloqueado) return { puede: true };

  /*
   * La DISPONIBILIDAD siempre es del local, incluso en lo estándar. Si se
   * quedaron sin producto, tienen que poder agotarlo — obligarles a seguir
   * vendiéndolo produce comandas que la cocina no puede sacar.
   */
  if (campo === "disponibilidad") return { puede: true };

  if (campo === "precio") {
    return estandar.precio_fijo
      ? { puede: false, razon: "El precio de este producto lo fija la franquicia" }
      : { puede: true };
  }

  return { puede: false, razon: "Este producto es del catálogo estándar de la franquicia" };
}

export function streamEmpresas(grupo_id: ID): ID {
  return `empresas:${grupo_id}`;
}
