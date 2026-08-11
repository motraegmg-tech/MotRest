/**
 * Qué mesas atiende cada mesero, y en qué día de la semana.
 *
 * ## Por qué esto es catálogo y no bitácora
 *
 * Igual que el plano de piso y la carta (TRD §5.2), el rol de mesas es una
 * INSTANTÁNEA versionada, no un event log. La diferencia con la operación es la
 * de siempre: a nadie le importa el historial de cómo se llegó al rol de esta
 * semana, pero a todo el mundo le importa cada peso cobrado. Se replica entre
 * terminales comparando `version` y `updated_at`.
 *
 * ## Por qué por día de la semana y no por fecha
 *
 * Un restaurante no arma un rol nuevo cada día: arma UNO y lo repite, con la
 * salvedad de que viernes y sábado entra más gente. Una tabla de siete columnas
 * es lo que el encargado ya tiene en un papel pegado en la cocina, y guardarla
 * por fecha obligaría a recapturarla todas las semanas para no decir nada nuevo.
 *
 * ## Qué NO decide esto
 *
 * No es una cerradura. Que una mesa no sea tuya no te impide atenderla —en un
 * viernes eso sería insufrible—: decide a quién se le AVISA cuando cocina deja
 * un platillo listo, y a nombre de quién se lee el salón. Los permisos siguen
 * viviendo en la matriz de roles.
 */
import type { ID } from "../comun/ids.js";

/** 0 = domingo … 6 = sábado, igual que `Date.prototype.getDay()`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DIAS_DEL_ROL: { valor: DiaSemana; nombre: string; corto: string }[] = [
  { valor: 1, nombre: "Lunes", corto: "Lun" },
  { valor: 2, nombre: "Martes", corto: "Mar" },
  { valor: 3, nombre: "Miércoles", corto: "Mié" },
  { valor: 4, nombre: "Jueves", corto: "Jue" },
  { valor: 5, nombre: "Viernes", corto: "Vie" },
  { valor: 6, nombre: "Sábado", corto: "Sáb" },
  // El domingo va al final y no al principio: la semana de un restaurante
  // empieza en lunes, aunque `getDay()` lo numere como cero.
  { valor: 0, nombre: "Domingo", corto: "Dom" },
];

export interface AsignacionMesa {
  mesa_id: ID;
  dia: DiaSemana;
  /** Meseros que la atienden ese día. Vacío = la mesa queda sin dueño. */
  meseros: ID[];
}

export interface RolDeMesas {
  version: number;
  updated_at: number;
  asignaciones: AsignacionMesa[];
}

export function rolDeMesasVacio(): RolDeMesas {
  return { version: 1, updated_at: Date.now(), asignaciones: [] };
}

/** Qué día de la semana es un instante dado. */
export function diaDeLaSemana(ts: number = Date.now()): DiaSemana {
  return new Date(ts).getDay() as DiaSemana;
}

export function nombreDia(dia: DiaSemana): string {
  return DIAS_DEL_ROL.find((d) => d.valor === dia)?.nombre ?? "—";
}

/** Quiénes atienden esta mesa ese día. */
export function meserosDeMesa(rol: RolDeMesas, mesaId: ID, dia: DiaSemana): ID[] {
  return rol.asignaciones.find((a) => a.mesa_id === mesaId && a.dia === dia)?.meseros ?? [];
}

/** Las mesas de un mesero ese día. */
export function mesasDeMesero(rol: RolDeMesas, meseroId: ID, dia: DiaSemana): ID[] {
  return rol.asignaciones
    .filter((a) => a.dia === dia && a.meseros.includes(meseroId))
    .map((a) => a.mesa_id);
}

/**
 * ¿Esta mesa es de este mesero?
 *
 * Una mesa **sin nadie asignado es de todos**, y eso es deliberado: si el
 * silencio significara «de nadie», un local que todavía no ha capturado su rol
 * —o que acaba de añadir una mesa— dejaría de avisar de los platillos listos sin
 * que nadie entendiera por qué. El rol sirve para afinar, no para apagar.
 */
export function atiendeLaMesa(
  rol: RolDeMesas,
  mesaId: ID,
  meseroId: ID,
  dia: DiaSemana,
): boolean {
  const asignados = meserosDeMesa(rol, mesaId, dia);
  return asignados.length === 0 || asignados.includes(meseroId);
}

/** Sube la versión y sella el cambio con el reloj del dispositivo (ADR-17). */
function conVersion(rol: RolDeMesas, asignaciones: AsignacionMesa[]): RolDeMesas {
  return {
    version: rol.version + 1,
    updated_at: Date.now(),
    // Una mesa sin nadie no se guarda: el vacío ya es el valor por defecto, y
    // conservarlo llenaría el catálogo de renglones que no dicen nada.
    asignaciones: asignaciones.filter((a) => a.meseros.length > 0),
  };
}

/** Deja la mesa de ese día EXACTAMENTE en manos de estos meseros. */
export function asignarMesa(
  rol: RolDeMesas,
  mesaId: ID,
  dia: DiaSemana,
  meseros: readonly ID[],
): RolDeMesas {
  const limpios = [...new Set(meseros)];
  const resto = rol.asignaciones.filter((a) => !(a.mesa_id === mesaId && a.dia === dia));
  return conVersion(rol, [...resto, { mesa_id: mesaId, dia, meseros: limpios }]);
}

/** Pone o quita a un mesero de una mesa. Es lo que hace un toque en la tabla. */
export function alternarMesero(
  rol: RolDeMesas,
  mesaId: ID,
  dia: DiaSemana,
  meseroId: ID,
): RolDeMesas {
  const actuales = meserosDeMesa(rol, mesaId, dia);
  return asignarMesa(
    rol,
    mesaId,
    dia,
    actuales.includes(meseroId)
      ? actuales.filter((id) => id !== meseroId)
      : [...actuales, meseroId],
  );
}

/**
 * Copia el rol de un día sobre otro.
 *
 * Es el atajo que convierte la tabla en algo que se llena en un minuto: se
 * captura el lunes y se replica al resto, ajustando solo el fin de semana.
 */
export function copiarDia(rol: RolDeMesas, origen: DiaSemana, destino: DiaSemana): RolDeMesas {
  if (origen === destino) return rol;
  const delOrigen = rol.asignaciones
    .filter((a) => a.dia === origen)
    .map((a) => ({ mesa_id: a.mesa_id, dia: destino, meseros: [...a.meseros] }));
  const resto = rol.asignaciones.filter((a) => a.dia !== destino);
  return conVersion(rol, [...resto, ...delOrigen]);
}

/** Borra el rol de un día entero. */
export function vaciarDia(rol: RolDeMesas, dia: DiaSemana): RolDeMesas {
  return conVersion(
    rol,
    rol.asignaciones.filter((a) => a.dia !== dia),
  );
}

/**
 * Saca de todo el rol a alguien que ya no trabaja aquí, o una mesa que se quitó
 * del plano. Sin esto, la tabla acabaría enseñando nombres de gente que se fue.
 */
export function depurar(
  rol: RolDeMesas,
  mesasVigentes: ReadonlySet<ID>,
  meserosVigentes: ReadonlySet<ID>,
): RolDeMesas {
  const limpias = rol.asignaciones
    .filter((a) => mesasVigentes.has(a.mesa_id))
    .map((a) => ({ ...a, meseros: a.meseros.filter((id) => meserosVigentes.has(id)) }))
    .filter((a) => a.meseros.length > 0);

  const cambio =
    limpias.length !== rol.asignaciones.length ||
    limpias.some((a, i) => a.meseros.length !== rol.asignaciones[i]?.meseros.length);

  return cambio ? conVersion(rol, limpias) : rol;
}
