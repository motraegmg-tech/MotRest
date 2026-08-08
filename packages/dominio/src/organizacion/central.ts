/**
 * La cartera de MOTRAE: todos los restaurantes que usan MotRest (F4).
 *
 * Esto NO vive en el software del restaurante. Vive en **MOTRAE Central**, la
 * aplicación de Gonzalo, y es la vista del negocio del proveedor: quién paga,
 * quién no, quién tiene un problema y quién está a punto de tenerlo.
 *
 * LA PREGUNTA QUE TIENE QUE CONTESTAR UNA MAÑANA, en este orden:
 *
 *   1. ¿Algún restaurante está caído o a punto de bloquearse hoy?
 *   2. ¿A quién hay que cobrarle esta semana?
 *   3. ¿Cuánto entra este mes?
 *
 * Todo lo demás es secundario. Un panel que empieza por la gráfica de ingresos y
 * esconde "Rodizio lleva 30 horas sin reportar" está ordenado al revés: el
 * ingreso del mes que viene depende justamente de que Rodizio esté funcionando
 * hoy.
 *
 * QUÉ NO ENTRA AQUÍ. Las ventas del restaurante, sus clientes, sus recetas. Lo
 * que MOTRAE necesita saber para operar el servicio es si el sistema está vivo y
 * si está pagado — no qué vendieron. El pulso trae cifras gruesas del día
 * porque sirven para detectar que algo se rompió (un local que factura cero un
 * viernes tiene un problema), no para husmear.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import {
  situacionDe,
  type EstadoLicencia,
  type Licencia,
  type PerfilResponsable,
  type Plan,
} from "./licencia.js";

/** Un restaurante cliente de MotRest. */
export interface ClienteMotRest {
  /** Es el `sucursal_id` del local. Uno por caja instalada. */
  id: ID;
  nombre: string;
  /** A quién se le llama cuando algo pasa. */
  contacto: string;
  /** Cuenta propietaria preparada por Central, sin su hash de acceso. */
  responsable?: PerfilResponsable;
  telefono?: string;
  correo?: string;
  plan: Plan;
  /** Lo que paga al mes (o al año, según el plan). */
  cuota: Centavos;
  alta_ts: number;
  /** La última licencia emitida para este local. */
  licencia: Licencia | null;
  /** false = se dio de baja. Deja de contar para todo. */
  activo: boolean;
  /** Notas de MOTRAE. Nunca las ve el restaurante. */
  notas?: string;
}

/**
 * Lo que cada Hub reporta a Central, una vez al día y al arrancar.
 *
 * Va por el relay, que es la única pieza de MOTRAE conectada a internet. Si el
 * relay se cae, los restaurantes siguen operando y Central deja de ver — que es
 * el reparto correcto del riesgo.
 */
export interface PulsoCliente {
  sucursal_id: ID;
  ts: number;
  /** Qué versión de MotRest tiene instalada. */
  version: string;
  /** Cifras gruesas del último día cerrado. Para detectar averías. */
  ventas_dia?: Centavos;
  cuentas_dia?: number;
  /** Cuántas terminales están emparejadas. */
  terminales?: number;
  /** Cuándo fue el último respaldo. Un respaldo viejo es una bomba de tiempo. */
  respaldo_ts?: number;
  /** Cuántos eventos lleva el log (ADR-21 avisa a los 400 000). */
  eventos?: number;
  /** Lo que el propio Hub detectó mal. */
  problemas?: string[];
}

// --- El cobro -------------------------------------------------------------------------------

export type EstadoCobro =
  | "al_corriente"
  /** Vence dentro de poco: es a quien hay que cobrarle esta semana. */
  | "por_cobrar"
  /** Ya venció pero está en gracia. Todavía opera. */
  | "vencido"
  /** Se acabó la gracia: está bloqueado y no puede trabajar. */
  | "bloqueado"
  /** Nunca se le emitió licencia. */
  | "sin_licencia";

/** Con cuántos días de anticipación aparece en "por cobrar". */
export const DIAS_PARA_COBRAR = 7;

export interface SituacionCliente {
  cliente: ClienteMotRest;
  cobro: EstadoCobro;
  /** Días para vencer. Negativo = ya venció. */
  dias: number;
  licencia: EstadoLicencia;
}

export function situacionDeCliente(
  cliente: ClienteMotRest,
  ahora = Date.now(),
): SituacionCliente {
  const situacion = situacionDe(cliente.licencia, cliente.licencia !== null, ahora);

  const cobro: EstadoCobro = !cliente.licencia
    ? "sin_licencia"
    : situacion.estado === "bloqueada"
      ? "bloqueado"
      : situacion.estado === "gracia"
        ? "vencido"
        : situacion.dias <= DIAS_PARA_COBRAR
          ? "por_cobrar"
          : "al_corriente";

  return { cliente, cobro, dias: situacion.dias, licencia: situacion.estado };
}

// --- La salud -------------------------------------------------------------------------------

export type EstadoSalud =
  | "bien"
  /** Algo que revisar sin urgencia: respaldo viejo, log creciendo. */
  | "atencion"
  /** Lleva demasiado sin dar señales. Puede estar apagado o sin internet. */
  | "sin_senal"
  /** Nunca ha reportado. Instalación que quizá no se completó. */
  | "nunca_reporto";

/**
 * Cuántas horas sin reportar antes de encender la alarma.
 *
 * 30 y no 24: un restaurante que cierra los lunes deja de reportar más de un
 * día entero sin que pase nada. Con 24 h, cada martes por la mañana Central
 * estaría gritando por locales que están perfectamente.
 */
export const HORAS_SIN_SENAL = 30;

/** A partir de aquí el log conviene archivarlo (ADR-21). */
export const EVENTOS_AVISO = 400_000;
/** Un respaldo de hace más de tres días es un respaldo que no sirve. */
export const HORAS_RESPALDO = 72;

export interface SaludCliente {
  sucursal_id: ID;
  nombre: string;
  estado: EstadoSalud;
  /** Qué está mal, dicho para poder actuar. */
  motivos: string[];
  pulso: PulsoCliente | null;
  /** Horas desde el último reporte, o null si nunca reportó. */
  horas_sin_senal: number | null;
}

export function saludDeCliente(
  cliente: ClienteMotRest,
  pulso: PulsoCliente | null,
  ahora = Date.now(),
): SaludCliente {
  const base = { sucursal_id: cliente.id, nombre: cliente.nombre, pulso };

  if (!pulso) {
    return {
      ...base,
      estado: "nunca_reporto",
      motivos: ["Nunca ha reportado: revisar que la instalación se completara"],
      horas_sin_senal: null,
    };
  }

  const horas = (ahora - pulso.ts) / 3_600_000;
  const motivos: string[] = [];

  if (horas > HORAS_SIN_SENAL) {
    return {
      ...base,
      estado: "sin_senal",
      motivos: [`Lleva ${Math.floor(horas)} h sin reportar`],
      horas_sin_senal: horas,
    };
  }

  if (pulso.respaldo_ts && (ahora - pulso.respaldo_ts) / 3_600_000 > HORAS_RESPALDO) {
    motivos.push("El último respaldo tiene más de tres días");
  }
  if (pulso.respaldo_ts === undefined) {
    motivos.push("No hay ningún respaldo registrado");
  }
  if ((pulso.eventos ?? 0) > EVENTOS_AVISO) {
    motivos.push(`El registro va por ${pulso.eventos!.toLocaleString("es-MX")} eventos`);
  }
  for (const problema of pulso.problemas ?? []) motivos.push(problema);

  return {
    ...base,
    estado: motivos.length > 0 ? "atencion" : "bien",
    motivos,
    horas_sin_senal: horas,
  };
}

// --- La cartera entera ----------------------------------------------------------------------

export interface ResumenCartera {
  /** Locales activos. */
  locales: number;
  /** Lo que entra al mes si todos pagan. */
  ingreso_mensual: Centavos;
  al_corriente: number;
  por_cobrar: number;
  vencidos: number;
  bloqueados: number;
  /** Locales con algún problema de salud. */
  con_problemas: number;
  /** Versiones distintas instaladas. Muchas = despliegue disperso. */
  versiones: { version: string; locales: number }[];
}

/**
 * El resumen de arriba del panel.
 *
 * El ingreso mensual normaliza el plan anual dividiendo entre doce: mezclar una
 * anualidad con once mensualidades y llamarlo "lo que entra este mes" da un
 * número que no significa nada.
 */
export function resumenDeCartera(
  clientes: readonly ClienteMotRest[],
  pulsos: readonly PulsoCliente[],
  ahora = Date.now(),
): ResumenCartera {
  const activos = clientes.filter((c) => c.activo);
  const porSucursal = new Map<ID, PulsoCliente>();
  for (const p of pulsos) {
    const previo = porSucursal.get(p.sucursal_id);
    if (!previo || p.ts > previo.ts) porSucursal.set(p.sucursal_id, p);
  }

  let ingreso: Centavos = CERO;
  let al_corriente = 0;
  let por_cobrar = 0;
  let vencidos = 0;
  let bloqueados = 0;
  let con_problemas = 0;
  const versiones = new Map<string, number>();

  for (const cliente of activos) {
    // El plan anual se reparte entre doce para que el total sea comparable.
    ingreso = sumar(ingreso, (cliente.plan === "anual"
      ? Math.round(cliente.cuota / 12)
      : cliente.cuota) as Centavos);

    switch (situacionDeCliente(cliente, ahora).cobro) {
      case "al_corriente": al_corriente += 1; break;
      case "por_cobrar": por_cobrar += 1; break;
      case "vencido": vencidos += 1; break;
      case "bloqueado": bloqueados += 1; break;
      case "sin_licencia": break;
    }

    const pulso = porSucursal.get(cliente.id) ?? null;
    const salud = saludDeCliente(cliente, pulso, ahora);
    if (salud.estado !== "bien") con_problemas += 1;
    if (pulso) versiones.set(pulso.version, (versiones.get(pulso.version) ?? 0) + 1);
  }

  return {
    locales: activos.length,
    ingreso_mensual: ingreso,
    al_corriente,
    por_cobrar,
    vencidos,
    bloqueados,
    con_problemas,
    versiones: [...versiones.entries()]
      .map(([version, locales]) => ({ version, locales }))
      .sort((a, b) => b.locales - a.locales),
  };
}

/**
 * Lo que hay que atender HOY, ya ordenado por urgencia.
 *
 * ES LA LISTA QUE ABRE EL PANEL, y el orden no es alfabético a propósito. Un
 * local caído importa más que uno que debe: el que debe sigue vendiendo y va a
 * pagar; el caído está perdiendo dinero ahora mismo y va a llamar enojado.
 */
export type Urgencia = "caido" | "bloqueado" | "vence_hoy" | "por_cobrar" | "revisar";

export interface Pendiente {
  sucursal_id: ID;
  nombre: string;
  urgencia: Urgencia;
  detalle: string;
}

const ORDEN: Record<Urgencia, number> = {
  caido: 0,
  bloqueado: 1,
  vence_hoy: 2,
  por_cobrar: 3,
  revisar: 4,
};

export function pendientesDeHoy(
  clientes: readonly ClienteMotRest[],
  pulsos: readonly PulsoCliente[],
  ahora = Date.now(),
): Pendiente[] {
  const porSucursal = new Map<ID, PulsoCliente>();
  for (const p of pulsos) {
    const previo = porSucursal.get(p.sucursal_id);
    if (!previo || p.ts > previo.ts) porSucursal.set(p.sucursal_id, p);
  }

  const lista: Pendiente[] = [];

  for (const cliente of clientes.filter((c) => c.activo)) {
    const salud = saludDeCliente(cliente, porSucursal.get(cliente.id) ?? null, ahora);
    const { cobro, dias } = situacionDeCliente(cliente, ahora);
    const base = { sucursal_id: cliente.id, nombre: cliente.nombre };

    if (salud.estado === "sin_senal" || salud.estado === "nunca_reporto") {
      lista.push({ ...base, urgencia: "caido", detalle: salud.motivos[0] ?? "Sin señal" });
      continue;
    }

    if (cobro === "bloqueado") {
      lista.push({ ...base, urgencia: "bloqueado", detalle: `Bloqueado hace ${-dias - 3} días` });
      continue;
    }

    if (cobro === "vencido" || (cobro === "por_cobrar" && dias <= 0)) {
      lista.push({
        ...base,
        urgencia: "vence_hoy",
        detalle: dias === 0 ? "Vence hoy" : `Venció hace ${-dias} días — en gracia`,
      });
      continue;
    }

    if (cobro === "por_cobrar") {
      lista.push({ ...base, urgencia: "por_cobrar", detalle: `Vence en ${dias} días` });
      continue;
    }

    if (salud.estado === "atencion") {
      lista.push({ ...base, urgencia: "revisar", detalle: salud.motivos[0]! });
    }
  }

  return lista.sort(
    (a, b) => ORDEN[a.urgencia] - ORDEN[b.urgencia] || a.nombre.localeCompare(b.nombre, "es"),
  );
}

/**
 * Genera el identificador de un local nuevo.
 *
 * Legible a propósito: `suc-rodizio-centro` en la pantalla de un soporte
 * telefónico vale mucho más que un UUID, y este id se dicta por teléfono más
 * veces de las que nadie querría.
 */
export function idDeSucursal(nombre: string, sufijo = ""): ID {
  const limpio = (texto: string) =>
    texto
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const partes = [limpio(nombre), limpio(sufijo)].filter(Boolean);
  return `suc-${partes.join("-")}` || "suc-sin-nombre";
}
