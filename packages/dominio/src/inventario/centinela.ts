/**
 * Centinela de mermas (capacidad C5): dónde se está fugando el dinero.
 *
 * Es una de las capacidades por las que MOTRAE cobra por resultado: no basta con
 * registrar la merma, hay que SEÑALAR la que se sale de lo normal y ponerle un
 * número en pesos. Esa cifra es la que sustenta el ahorro verificado.
 *
 * Mide dos fugas distintas y NO las confunde:
 *
 *   - **Merma declarada**: lo que alguien registró como desperdicio —se cayó, se
 *     venció, se quemó—. Es honesto, pero cuesta.
 *   - **Faltante de conteo**: cuando el conteo físico encuentra MENOS de lo que
 *     el sistema esperaba. Eso es lo que nadie registró: sobre-porción, robo,
 *     derrame. Es la fuga que no se ve, y suele ser la cara.
 *
 * Lo que se consumió por receta NO es merma: es el costo legítimo de lo vendido.
 * Se usa solo como base para medir qué tan grande es la fuga frente al uso normal.
 */
import { CERO, pesos, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoInventario } from "./eventos.js";
import type { Insumo, Unidad } from "./insumos.js";
import { valorDe } from "./reducers.js";

export type SeveridadMerma = "alta" | "media" | "ok";

export interface AlertaMerma {
  insumo_id: ID;
  nombre: string;
  unidad: Unidad;
  /** Consumo legítimo por receta, en unidad base. La base contra la que se compara. */
  consumo: number;
  costo_consumo: Centavos;
  /** Cantidad registrada como merma. */
  merma: number;
  costo_merma: Centavos;
  /** Faltante hallado en conteos: lo que el sistema esperaba de más. */
  faltante: number;
  costo_faltante: Centavos;
  /** Merma + faltante, en pesos. Lo que se fugó. */
  perdida: Centavos;
  /** Fuga como fracción de lo que se movió (fuga + consumo legítimo). */
  tasa: number;
  severidad: SeveridadMerma;
}

export interface ResumenCentinela {
  /** Solo los insumos con alguna pérdida, del que más pierde al que menos. */
  alertas: AlertaMerma[];
  perdida_total: Centavos;
  costo_merma_total: Centavos;
  costo_faltante_total: Centavos;
  /** Cuántos insumos están en severidad alta. */
  criticos: number;
}

/** Umbrales de la tasa de fuga. Por encima del 10 % del uso, algo pasa. */
const UMBRAL_ALTA = 0.1;
const UMBRAL_MEDIA = 0.05;

/** Debajo de esto no se marca en rojo aunque la tasa sea alta: no vale la pena
 * mandar a alguien a investigar veinte pesos de perejil. */
const PISO_RELEVANTE = pesos(20);

function severidadDe(tasa: number, perdida: Centavos): SeveridadMerma {
  if (perdida < PISO_RELEVANTE) return "ok";
  if (tasa >= UMBRAL_ALTA) return "alta";
  if (tasa >= UMBRAL_MEDIA) return "media";
  return "ok";
}

export function centinelaMermas(
  eventos: readonly EventoInventario[],
  insumos: readonly Insumo[],
): ResumenCentinela {
  const porId = new Map(insumos.map((i) => [i.id, i]));

  // Acumuladores por insumo: consumo legítimo, merma y faltante de conteo.
  const consumo = new Map<ID, number>();
  const merma = new Map<ID, number>();
  const faltante = new Map<ID, number>();
  const suma = (m: Map<ID, number>, id: ID, n: number) => m.set(id, (m.get(id) ?? 0) + n);

  for (const ev of eventos) {
    if (ev.tipo === "movimiento_inventario") {
      /*
       * Consumo LEGÍTIMO es todo lo que salió a propósito: lo que se llevaron
       * las recetas y lo que alguien declaró como utilización —la comida del
       * personal, la masa de la prueba—, menos lo que regresó al cancelarse un
       * platillo. Es la base contra la que se mide la fuga, así que dejar fuera
       * la utilización habría hecho ver como pérdida del 100 % un insumo que se
       * gasta bien pero no se vende.
       */
      if (ev.motivo === "consumo_receta" || ev.motivo === "utilizacion") {
        suma(consumo, ev.insumo_id, Math.abs(ev.delta));
      } else if (ev.motivo === "reverso_receta") {
        suma(consumo, ev.insumo_id, -Math.abs(ev.delta));
      } else if (ev.motivo === "merma") suma(merma, ev.insumo_id, Math.abs(ev.delta));
    } else if (ev.tipo === "conteo_registrado") {
      for (const linea of ev.lineas) {
        // Solo el faltante es fuga. Que sobre suele ser un registro previo mal
        // hecho, no una pérdida: no se resta de lo que falta en otro insumo.
        const falto = linea.esperado - linea.contado;
        if (falto > 0) suma(faltante, linea.insumo_id, falto);
      }
    }
  }

  const ids = new Set<ID>([...merma.keys(), ...faltante.keys()]);
  const alertas: AlertaMerma[] = [];
  let costoMermaTotal = CERO;
  let costoFaltanteTotal = CERO;

  for (const id of ids) {
    const insumo = porId.get(id);
    if (!insumo) continue;

    const cantMerma = merma.get(id) ?? 0;
    const cantFaltante = faltante.get(id) ?? 0;
    const cantConsumo = consumo.get(id) ?? 0;

    const costoMerma = valorDe(insumo, cantMerma);
    const costoFaltante = valorDe(insumo, cantFaltante);
    const perdida = sumar(costoMerma, costoFaltante);
    if (perdida <= 0) continue;

    const costoConsumo = valorDe(insumo, cantConsumo);
    const base = perdida + costoConsumo;
    const tasa = base > 0 ? perdida / base : 1;

    costoMermaTotal = sumar(costoMermaTotal, costoMerma);
    costoFaltanteTotal = sumar(costoFaltanteTotal, costoFaltante);

    alertas.push({
      insumo_id: id,
      nombre: insumo.nombre,
      unidad: insumo.unidad_base,
      consumo: cantConsumo,
      costo_consumo: costoConsumo,
      merma: cantMerma,
      costo_merma: costoMerma,
      faltante: cantFaltante,
      costo_faltante: costoFaltante,
      perdida,
      tasa,
      severidad: severidadDe(tasa, perdida),
    });
  }

  alertas.sort((a, b) => b.perdida - a.perdida);

  return {
    alertas,
    perdida_total: sumar(costoMermaTotal, costoFaltanteTotal),
    costo_merma_total: costoMermaTotal,
    costo_faltante_total: costoFaltanteTotal,
    criticos: alertas.filter((a) => a.severidad === "alta").length,
  };
}

/** Qué hacer con cada alerta, en una línea. */
export function consejoMerma(alerta: AlertaMerma): string {
  if (alerta.costo_faltante > alerta.costo_merma) {
    return "Falta más de lo que se declaró como merma: revisa porciones, registro de desperdicio y accesos al almacén.";
  }
  if (alerta.severidad === "alta") {
    return "La merma declarada es alta frente a lo que se usa: revisa manejo, caducidades y tamaño de compra.";
  }
  return "Bajo control. Se vigila para que no se dispare.";
}
