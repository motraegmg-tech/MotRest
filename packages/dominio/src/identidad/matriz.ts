/**
 * Evaluación de permisos: la matriz rol × acción del TRD §10.
 *
 * Devuelve TRES resultados, no un booleano. El tercero —"requiere
 * autorización"— es el que dispara el teclado de PIN de un rol autorizante,
 * que es el flujo real de un restaurante: el mesero puede pedir la cancelación,
 * pero la firma el gerente, y queda en la bitácora.
 *
 * Esta función se usa en el cliente para la experiencia; cuando llegue el Hub,
 * él la volverá a evaluar y su veredicto será el que mande (nunca se confía en
 * el cliente).
 */
import type { Accion } from "./acciones.js";
import { definicionAccion } from "./acciones.js";
import {
  LISTA_ROLES,
  rangoDe,
  type Nivel,
  type Permiso,
  type RolId,
  type Usuario,
} from "./roles.js";

/** Contexto de la acción concreta, para evaluar los límites. */
export interface ContextoAccion {
  /** Monto involucrado, en centavos (retiros, egresos). */
  monto?: number;
  /** Porcentaje involucrado como fracción 0..1 (descuentos). */
  porcentaje?: number;
  /** Dueño del recurso: permite distinguir "mis mesas" de "las ajenas". */
  propietario_id?: string;
}

export type Veredicto =
  | { resultado: "permitido" }
  | { resultado: "denegado"; razon: string }
  | { resultado: "requiere_autorizacion"; roles_autorizantes: RolId[]; razon: string };

/** ¿La acción es de solo consulta? Se deduce del nombre (`…​.ver`, `…​.ver_*`). */
export function esLectura(accion: Accion): boolean {
  return accion.endsWith(".ver") || accion.includes(".ver_");
}

/** Roles cuya plantilla puede AUTORIZAR la acción indicada. */
export function rolesQueAutorizan(accion: Accion): RolId[] {
  return LISTA_ROLES.filter((rol) =>
    rol.permisos.some((x) => x.accion === accion && x.nivel === "autorizar"),
  ).map((rol) => rol.id);
}

function permisoDe(usuario: Usuario, accion: Accion): Permiso | undefined {
  return usuario.permisos.find((x) => x.accion === accion);
}

function excedeLimite(permiso: Permiso, ctx: ContextoAccion | undefined): boolean {
  if (permiso.limite === undefined || !ctx) return false;
  if (ctx.porcentaje !== undefined && ctx.porcentaje > permiso.limite) return true;
  if (ctx.monto !== undefined && ctx.monto > permiso.limite) return true;
  return false;
}

/**
 * Evalúa si `usuario` puede ejecutar `accion` en el contexto dado.
 *
 * - Sin permiso: si la acción es sensible, se ofrece pedir autorización; si no,
 *   se deniega.
 * - Con nivel "ver" sobre una acción que modifica: no basta.
 * - Con nivel suficiente pero excediendo el límite: requiere autorización.
 */
export function evaluar(
  usuario: Usuario,
  accion: Accion,
  ctx?: ContextoAccion,
): Veredicto {
  if (!usuario.activo) {
    return { resultado: "denegado", razon: "El usuario está desactivado" };
  }

  const definicion = definicionAccion(accion);
  const sensible = definicion?.sensible ?? false;
  const etiqueta = definicion?.etiqueta ?? accion;
  const permiso = permisoDe(usuario, accion);

  if (!permiso) {
    const autorizantes = rolesQueAutorizan(accion);
    if (sensible && autorizantes.length > 0) {
      return {
        resultado: "requiere_autorizacion",
        roles_autorizantes: autorizantes,
        razon: `"${etiqueta}" requiere autorización de un superior`,
      };
    }
    return { resultado: "denegado", razon: `Sin permiso para "${etiqueta}"` };
  }

  // Nivel "ver" solo alcanza para consultar.
  if (permiso.nivel === "ver" && !esLectura(accion)) {
    const autorizantes = rolesQueAutorizan(accion);
    if (sensible && autorizantes.length > 0) {
      return {
        resultado: "requiere_autorizacion",
        roles_autorizantes: autorizantes,
        razon: `"${etiqueta}" requiere autorización: solo tienes acceso de consulta`,
      };
    }
    return { resultado: "denegado", razon: `Solo tienes acceso de consulta a "${etiqueta}"` };
  }

  if (excedeLimite(permiso, ctx)) {
    const autorizantes = rolesQueAutorizan(accion).filter((r) => r !== usuario.rol_id);
    return {
      resultado: "requiere_autorizacion",
      roles_autorizantes: autorizantes.length > 0 ? autorizantes : ["propietario"],
      razon: `"${etiqueta}" excede tu límite autorizado`,
    };
  }

  return { resultado: "permitido" };
}

/** Atajo para la UI: ¿puede verlo? (oculta food cost, cortes, bitácora…). */
export function puedeVer(usuario: Usuario, accion: Accion): boolean {
  return !!permisoDe(usuario, accion) && usuario.activo;
}

/** Atajo: ¿puede ejecutarlo sin pedir permiso a nadie? */
export function puedeOperar(usuario: Usuario, accion: Accion, ctx?: ContextoAccion): boolean {
  return evaluar(usuario, accion, ctx).resultado === "permitido";
}

/** ¿Este usuario puede firmar la autorización de la acción? */
export function puedeAutorizar(usuario: Usuario, accion: Accion): boolean {
  const permiso = permisoDe(usuario, accion);
  return usuario.activo && permiso?.nivel === "autorizar";
}

// --- Jerarquía: nadie administra a un igual ni a un superior ------------------

const ORDEN_NIVEL: Record<Nivel, number> = { ver: 1, operar: 2, autorizar: 3 };

/** Nivel que tiene el usuario sobre una acción, o null si no la tiene. */
export function nivelDe(usuario: Usuario, accion: Accion): Nivel | null {
  return permisoDe(usuario, accion)?.nivel ?? null;
}

/**
 * ¿`actor` puede administrar a `objetivo` (editar permisos, activar, desbloquear)?
 *
 * Exige rango ESTRICTAMENTE mayor. Un gerente no toca a la dirección, ni a otro
 * gerente, ni a sí mismo: así se cierra la escalada de privilegios.
 */
export function puedeGestionarA(actor: Usuario, objetivo: Usuario): boolean {
  if (!actor.activo) return false;
  if (actor.id === objetivo.id) return false;
  return rangoDe(actor.rol_id) > rangoDe(objetivo.rol_id);
}

/** Roles que `actor` puede asignar al dar de alta: solo por debajo del suyo. */
export function rolesAsignablesPor(actor: Usuario): RolId[] {
  const propio = rangoDe(actor.rol_id);
  return LISTA_ROLES.filter((r) => rangoDe(r.id) < propio).map((r) => r.id);
}

/**
 * ¿`actor` puede otorgar este permiso?
 *
 * Solo se concede lo que uno mismo tiene, y nunca a un nivel superior al propio.
 * Sin esta regla, alguien podría escalar creando un usuario con más poder que él
 * y entrando con esa cuenta.
 */
export function puedeOtorgar(actor: Usuario, permiso: Permiso): boolean {
  const propio = nivelDe(actor, permiso.accion);
  if (!propio) return false;
  if (ORDEN_NIVEL[permiso.nivel] > ORDEN_NIVEL[propio]) return false;

  // Un límite propio no se puede superar al delegarlo.
  const limitePropio = permisoDe(actor, permiso.accion)?.limite;
  if (limitePropio !== undefined) {
    if (permiso.limite === undefined) return false;
    if (permiso.limite > limitePropio) return false;
  }
  return true;
}

/** Permisos de la lista que `actor` NO está facultado para otorgar. */
export function permisosNoOtorgables(actor: Usuario, permisos: readonly Permiso[]): Permiso[] {
  return permisos.filter((p) => !puedeOtorgar(actor, p));
}
