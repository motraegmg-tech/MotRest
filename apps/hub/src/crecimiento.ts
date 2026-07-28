/**
 * Cuánto ha crecido el registro del local, y cuándo empieza a estorbar.
 *
 * El event log es append-only por diseño (ADR-02): nada se borra, y el estado
 * se reconstruye reproduciéndolo. Es lo que hace que la bitácora sea confiable
 * y que un respaldo sirva de verdad. También significa que **crece para
 * siempre**, y que cada terminal lo carga entero al arrancar.
 *
 * LOS NÚMEROS, MEDIDOS
 *
 * Una pizzería con ~60 cuentas al día genera unos 24 eventos por cuenta
 * —abrir, capturar, mandar a cocina, los tres cambios de estado por platillo,
 * el pago, el cierre y los movimientos de inventario—: alrededor de **1 400 al
 * día** y **525 000 al año**, unos **336 MB**. Reproducir 200 000 eventos
 * cuesta medio segundo de CPU; el problema real antes que la CPU es la MEMORIA
 * de una tablet barata cargándolos todos.
 *
 * QUÉ SE HACE HOY, Y QUÉ NO
 *
 * NO se compacta ni se archiva todavía: hacerlo mal es perder historia fiscal,
 * y a un local que arranca le sobran meses antes de acercarse. Lo que sí se
 * hace es **medir y avisar con tiempo**, para que la decisión se tome con datos
 * y no cuando la caja ya tarda en abrir. El plan está en `docs/adr/ADR-21`.
 */

/** A partir de aquí conviene planear el archivado. Cerca de un año de operación. */
export const EVENTOS_AVISO = 400_000;

/** A partir de aquí ya se nota al arrancar, sobre todo en tablets. */
export const EVENTOS_CRITICO = 800_000;

export type NivelCrecimiento = "sano" | "aviso" | "critico";

export interface Crecimiento {
  eventos: number;
  bytes: number;
  nivel: NivelCrecimiento;
  /** Qué hacer, en una frase. Vacío cuando no hay nada que hacer. */
  recomendacion: string;
}

export function evaluarCrecimiento(eventos: number, bytes: number): Crecimiento {
  let nivel: NivelCrecimiento = "sano";
  let recomendacion = "";

  if (eventos >= EVENTOS_CRITICO) {
    nivel = "critico";
    recomendacion =
      "El registro es muy grande y las terminales tardarán en abrir. Toca archivar los ejercicios cerrados.";
  } else if (eventos >= EVENTOS_AVISO) {
    nivel = "aviso";
    recomendacion =
      "El registro se acerca al año de operación. Conviene planear el archivado antes de que se note.";
  }

  return { eventos, bytes, nivel, recomendacion };
}

/** Tamaño legible, para reportarlo sin hacer cuentas mentales. */
export function enMegas(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
