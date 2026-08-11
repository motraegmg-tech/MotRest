/**
 * La cartera de MOTRAE: todos los restaurantes que usan MotRest (F4).
 *
 * Esto NO vive en el software del restaurante. Vive en **MotRest Central**, la
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

export type MetodoDePago = "transferencia" | "efectivo" | "tarjeta" | "otro";

/**
 * Un cobro que YA entró.
 *
 * Emitir una licencia y cobrarla son dos cosas distintas, y confundirlas es el
 * error más caro que puede cometer este panel. Antes, la única huella de un
 * cobro era el vencimiento de la licencia: si Gonzalo renovaba de confianza
 * mientras el restaurantero pagaba «la semana que entra», Central lo enseñaba
 * como al corriente y ese dinero no lo reclamaba nadie nunca.
 */
export interface PagoCliente {
  id: ID;
  ts: number;
  monto: Centavos;
  metodo: MetodoDePago;
  /** Hasta cuándo dejó cubierto al local, si el cobro fue de suscripción. */
  cubre_hasta_ts?: number;
  /** Si es la parte variable, de qué resultado salió. */
  resultado_id?: ID;
  nota?: string;
}

/**
 * Un ahorro medido en el restaurante y la parte que MOTRAE cobra por él.
 *
 * ES EL MODELO COMERCIAL DE MOTRAE, no un extra: suscripción por local **más
 * cobro por resultado**. Sin un sitio donde anotar el ahorro verificado, la
 * parte variable no se factura, y lo que queda es cobrar por licencia a secas
 * —justo lo que el principio de la empresa dice que no se hace—.
 *
 * `verificado` separa lo medido de lo estimado. Solo se cobra lo verificado: un
 * ahorro que el restaurantero no reconoce no es un ahorro, es una discusión.
 */
export interface ResultadoVerificado {
  id: ID;
  ts: number;
  /** Qué se midió. "Merma de masa: 12 % → 4 %". */
  concepto: string;
  /** Lo que el restaurante dejó de perder en el periodo medido. */
  ahorro: Centavos;
  /** Qué porcentaje de ese ahorro cobra MOTRAE. */
  comision_pct: number;
  /** false = todavía es una estimación y no se puede cobrar. */
  verificado: boolean;
  /** true = ya se emitió el cobro de su comisión. */
  cobrado: boolean;
}

/**
 * Una licencia que se firmó para este local, en su momento.
 *
 * `cliente.licencia` guarda solo la última. Cuando un restaurantero discute qué
 * se le emitió y cuándo —o cuando hay que reconstruir por qué un local quedó
 * bloqueado un viernes—, la última no contesta nada.
 */
export interface EmisionLicencia {
  ts: number;
  plan: Plan;
  vence_ts: number;
  /** La cuota vigente al emitir: lo que había que cobrar por esa renovación. */
  cuota: Centavos;
  /** true = se emitió para cortar el servicio de inmediato. */
  bloqueo_inmediato?: boolean;
}

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
  /** Todas las que se le han emitido, la más reciente al final. */
  emisiones?: EmisionLicencia[];
  /** Lo que ha pagado de verdad. */
  pagos?: PagoCliente[];
  /** Ahorros medidos y su comisión. */
  resultados?: ResultadoVerificado[];
  /** false = se dio de baja. Deja de contar para todo. */
  activo: boolean;
  /** Notas de MOTRAE. Nunca las ve el restaurante. */
  notas?: string;
}

/**
 * Una terminal del local tal como la reportó su Hub.
 *
 * Es el inventario del **equipo** que corre MotRest, no de quién lo usa: no
 * lleva empleados, ni turnos, ni nada de la operación. Contesta lo que hoy se
 * pregunta por teléfono en cada soporte —«¿cuántas tabletas tienes?», «¿la caja
 * de la barra está sincronizando?»— sin tener que ir al restaurante.
 *
 * No confundir con `TerminalDelLocal` (failover): aquélla es el censo que las
 * terminales usan entre ellas para elegir quién hace de Hub, y vive dentro del
 * restaurante. Ésta es lo que sale del restaurante hacia MOTRAE, y por eso trae
 * menos: ni papel, ni prioridad, ni nada con lo que se pueda mandar en el local.
 */
export interface TerminalReportada {
  /** Recortado. Sirve para reconocerla en un soporte, no para señalarla. */
  device_id: string;
  /** El nombre que le puso el restaurante. Vacío si nunca se lo pusieron. */
  nombre?: string;
  /** false = se presentó pero el restaurante nunca la autorizó. */
  aprobado: boolean;
  /** Última vez que sincronizó con el Hub. */
  visto_ts: number;
}

/**
 * Lo que cada Hub reporta a Central, una vez al día y al arrancar.
 *
 * Va por el relay, que es la única pieza de MOTRAE conectada a internet. Si el
 * relay se cae, los restaurantes siguen operando y Central deja de ver — que es
 * el reparto correcto del riesgo.
 *
 * TODO ES OPCIONAL MENOS LA VERSIÓN Y LA HORA. Un Hub viejo no manda los campos
 * que se añadieron después, y tiene que seguir contando que está vivo: si
 * Central exigiera el parte completo, la primera consecuencia de ampliarlo sería
 * que los locales que aún no se actualizan aparecieran como caídos.
 */
export interface PulsoCliente {
  sucursal_id: ID;
  ts: number;
  /** Qué versión de MotRest tiene instalada. */
  version: string;
  /** Cifras gruesas del último día cerrado. Para detectar averías. */
  ventas_dia?: Centavos;
  cuentas_dia?: number;
  /** Cuántas terminales están conectadas EN ESTE MOMENTO. */
  terminales?: number;
  /**
   * El inventario de terminales del local, conectadas o no.
   *
   * No es lo mismo que `terminales`, y la diferencia es justo lo que se quiere
   * ver: seis emparejadas y una conectada un viernes a las nueve de la noche es
   * un local con cinco tabletas apagadas o rotas.
   */
  dispositivos?: TerminalReportada[];
  /** Qué Hub manda el parte y sobre qué corre. Para el soporte. */
  hub_id?: string;
  plataforma?: string;
  /** ¿El Hub arranca solo al encender el equipo? Si no, el local abre a mano. */
  arranque_automatico?: boolean;
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
  /**
   * Lo que se cobró de verdad en los últimos 30 días.
   *
   * Va al lado del anterior a propósito, y la distancia entre los dos es el
   * único número honesto del panel: `ingreso_mensual` es una promesa, éste es
   * dinero. Un panel que solo enseña la promesa hace sentir un negocio que no
   * está pasando.
   */
  cobrado_mes: Centavos;
  /** Comisiones por resultado verificadas y todavía sin cobrar. */
  por_cobrar_resultados: Centavos;
  al_corriente: number;
  por_cobrar: number;
  vencidos: number;
  bloqueados: number;
  /** Locales con algún problema de salud. */
  con_problemas: number;
  /** Versiones distintas instaladas. Muchas = despliegue disperso. */
  versiones: { version: string; locales: number }[];
}

/** Treinta días, no «el mes natural»: lo que se compara es siempre lo mismo. */
export const DIAS_DE_COBRO_RECIENTE = 30;

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
    /*
     * Sin tope por arriba, y no es descuido.
     *
     * `ahora` es el reloj que el panel refresca cada minuto, no el instante
     * exacto. Cerrar la ventana ahí dejaba fuera el cobro que se acaba de anotar
     * —el que uno está mirando— hasta el siguiente tic, y un panel que tarda un
     * minuto en reconocer un pago parece roto. Un pago no puede ser del futuro:
     * se registra cuando entra.
     */
    cobrado_mes: cobradoEnPeriodo(
      clientes,
      ahora - DIAS_DE_COBRO_RECIENTE * 86_400_000,
      Number.POSITIVE_INFINITY,
    ),
    por_cobrar_resultados: comisionesPendientes(clientes),
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

// --- El dinero que entró de verdad -----------------------------------------------------------

/**
 * Lo cobrado entre dos fechas, en toda la cartera.
 *
 * Cuenta también los locales dados de baja: el dinero que pagó un cliente que
 * después se fue entró igual, y borrarlo del histórico haría que un mes cerrado
 * cambiara de cifra el día que alguien se da de baja.
 */
export function cobradoEnPeriodo(
  clientes: readonly ClienteMotRest[],
  desde: number,
  hasta: number,
): Centavos {
  let total: Centavos = CERO;
  for (const cliente of clientes) {
    for (const pago of cliente.pagos ?? []) {
      if (pago.ts >= desde && pago.ts <= hasta) total = sumar(total, pago.monto);
    }
  }
  return total;
}

/** Lo que MOTRAE se lleva de un ahorro medido. */
export function comisionDeResultado(resultado: ResultadoVerificado): Centavos {
  return Math.round(resultado.ahorro * (resultado.comision_pct / 100)) as Centavos;
}

/**
 * Comisiones ganadas y todavía sin cobrar.
 *
 * Solo cuenta lo `verificado`: una estimación que el restaurantero no ha
 * reconocido no es dinero por cobrar, es una conversación pendiente. Meterla
 * aquí sería inflar la cifra del negocio con trabajo que quizá no se pague.
 */
export function comisionesPendientes(clientes: readonly ClienteMotRest[]): Centavos {
  let total: Centavos = CERO;
  for (const cliente of clientes) {
    for (const resultado of cliente.resultados ?? []) {
      if (resultado.verificado && !resultado.cobrado) {
        total = sumar(total, comisionDeResultado(resultado));
      }
    }
  }
  return total;
}

/** Lo que este local ha pagado desde que es cliente. */
export function totalPagadoPor(cliente: ClienteMotRest): Centavos {
  return (cliente.pagos ?? []).reduce<Centavos>((suma, pago) => sumar(suma, pago.monto), CERO);
}

/**
 * El mensaje de cobro, escrito para mandarlo tal cual.
 *
 * Se genera aquí y no en la pantalla porque es lo que MOTRAE dice cuando pide
 * dinero, y eso no puede depender de cómo se sienta uno el martes. Dice el
 * plazo concreto y qué pasa si se vence: un recordatorio que no dice la
 * consecuencia se lee como opcional, y se acaba llamando por teléfono igual.
 */
export function mensajeDeCobro(
  cliente: ClienteMotRest,
  situacion: SituacionCliente,
  dinero: (centavos: Centavos) => string,
): string {
  const nombre = cliente.responsable?.nombre || cliente.contacto || "";
  const saludo = nombre ? `Hola, ${nombre}.` : "Hola.";
  const cuanto = dinero(cliente.cuota);
  const periodo = cliente.plan === "anual" ? "anualidad" : "mensualidad";

  if (situacion.cobro === "bloqueado") {
    return (
      `${saludo} El servicio de MotRest en ${cliente.nombre} está suspendido porque ` +
      `venció la ${periodo} y pasaron los tres días de gracia. En cuanto recibamos ` +
      `el pago de ${cuanto} lo reactivamos el mismo día. ¿Le ayudo con los datos?`
    );
  }

  if (situacion.cobro === "vencido") {
    const dias = Math.max(0, 3 + situacion.dias);
    return (
      `${saludo} La ${periodo} de MotRest en ${cliente.nombre} venció y estamos en el ` +
      `periodo de gracia: quedan ${dias} ${dias === 1 ? "día" : "días"} antes de que el ` +
      `sistema se suspenda. Son ${cuanto}. ¿Lo dejamos pagado hoy?`
    );
  }

  if (situacion.cobro === "sin_licencia") {
    return (
      `${saludo} Ya está listo MotRest para ${cliente.nombre}. Para activarlo ` +
      `necesitamos la ${periodo} de ${cuanto} y lo dejamos operando el mismo día.`
    );
  }

  return (
    `${saludo} Le recuerdo que la ${periodo} de MotRest en ${cliente.nombre} vence ` +
    `${situacion.dias === 0 ? "hoy" : `en ${situacion.dias} ${situacion.dias === 1 ? "día" : "días"}`}. ` +
    `Son ${cuanto}. Con el pago a tiempo el servicio no se interrumpe.`
  );
}

/**
 * Lo que hay que atender HOY, ya ordenado por urgencia.
 *
 * ES LA LISTA QUE ABRE EL PANEL, y el orden no es alfabético a propósito. Un
 * local caído importa más que uno que debe: el que debe sigue vendiendo y va a
 * pagar; el caído está perdiendo dinero ahora mismo y va a llamar enojado.
 */
/**
 * `caido` y `sin_telemetria` son cosas DISTINTAS, y colapsarlas costaba caro.
 *
 * Un local que reportaba y dejó de hacerlo está perdiendo dinero ahora mismo:
 * hay que llamar. Uno que no ha reportado nunca casi siempre es un local al que
 * le falta el enlace con MOTRAE —durante mucho tiempo eso le pasaba a TODO local
 * sin WhatsApp, porque el pulso colgaba de la mensajería—, y opera sin enterarse
 * de nada. Pintar los dos como la emergencia número uno del panel convierte la
 * lista en ruido: si Rodizio lleva meses en rojo estando sano, el día que caiga
 * de verdad nadie va a mirar.
 */
export type Urgencia =
  | "caido"
  | "bloqueado"
  | "vence_hoy"
  | "por_cobrar"
  | "sin_telemetria"
  | "revisar";

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
  // Debajo del cobro: no es una urgencia de hoy, es una instalación a medio
  // terminar. Importa —sin pulso no hay forma de saber si ese local está bien—
  // pero no puede desplazar a quien está sin vender.
  sin_telemetria: 4,
  revisar: 5,
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

    if (salud.estado === "sin_senal") {
      lista.push({ ...base, urgencia: "caido", detalle: salud.motivos[0] ?? "Sin señal" });
      continue;
    }

    if (salud.estado === "nunca_reporto") {
      lista.push({
        ...base,
        urgencia: "sin_telemetria",
        detalle: "Nunca ha reportado: falta el enlace con MOTRAE en su licencia",
      });
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

// --- La historia de cada local ---------------------------------------------------------------

/**
 * Cuántos partes se guardan por local.
 *
 * Con un pulso al día son unos cuatro meses, que es el horizonte en el que
 * alguien pregunta «¿esto ya pasaba antes de la 1.2?». Guardarlo todo para
 * siempre convertiría el panel en el archivo de la operación de la cartera, que
 * es justo lo que el relay tiene prohibido ser (TRD R3) y no hay razón para que
 * Central lo sea en su lugar.
 */
export const PULSOS_GUARDADOS = 120;

export interface HistoriaDelLocal {
  /** Cuántos partes distintos se conservan. */
  partes: number;
  /** Qué proporción de los días observados el local dio señales. */
  fiabilidad_pct: number;
  /** Desde cuándo lleva sin dar señales, si es que las perdió. */
  callado_desde_ts: number | null;
  /** Versiones por las que ha pasado, de la más reciente a la más vieja. */
  versiones: { version: string; desde_ts: number }[];
}

/**
 * Lee el historial de un local y contesta «¿desde cuándo va mal?».
 *
 * Un pulso suelto dice cómo está hoy. La pregunta que llega por teléfono es
 * siempre la otra: si esto empezó ayer o lleva tres semanas. Con un solo estado
 * guardado, la única respuesta posible era «no sé».
 *
 * La fiabilidad se mide contra los DÍAS que abarca el historial, no contra el
 * número de partes: un local que reportó tres veces en dos meses no es un local
 * con tres de tres.
 */
export function historiaDelLocal(
  historial: readonly PulsoCliente[],
  ahora = Date.now(),
): HistoriaDelLocal {
  const ordenados = [...historial].sort((a, b) => a.ts - b.ts);
  const primero = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];

  if (!primero || !ultimo) {
    return { partes: 0, fiabilidad_pct: 0, callado_desde_ts: null, versiones: [] };
  }

  const dias = Math.max(1, Math.round((ahora - primero.ts) / 86_400_000));
  const fiabilidad = Math.min(100, Math.round((ordenados.length / dias) * 100));

  /* Solo se llama «callado» pasado el umbral; si no, cada noche sería una caída. */
  const horasCallado = (ahora - ultimo.ts) / 3_600_000;

  const versiones: { version: string; desde_ts: number }[] = [];
  for (const pulso of ordenados) {
    if (versiones[0]?.version !== pulso.version) {
      versiones.unshift({ version: pulso.version, desde_ts: pulso.ts });
    }
  }

  return {
    partes: ordenados.length,
    fiabilidad_pct: fiabilidad,
    callado_desde_ts: horasCallado > HORAS_SIN_SENAL ? ultimo.ts : null,
    versiones,
  };
}

/**
 * Añade un parte al historial sin repetir el mismo dos veces.
 *
 * Central pregunta al relay cada diez minutos y el Hub reporta una vez al día,
 * así que la inmensa mayoría de las consultas devuelven EL MISMO pulso. Sin esta
 * comprobación, el historial se llenaría de copias del último parte en una tarde
 * y no guardaría ni un día de historia real.
 */
export function anotarEnHistorial(
  historial: readonly PulsoCliente[],
  pulso: PulsoCliente,
  tope = PULSOS_GUARDADOS,
): PulsoCliente[] {
  if (historial.some((p) => p.ts === pulso.ts)) return [...historial];
  return [...historial, pulso].sort((a, b) => a.ts - b.ts).slice(-tope);
}

// --- Cómo va un despliegue -------------------------------------------------------------------

export interface AdopcionDeVersion {
  /** La versión que se publicó. */
  version: string;
  /** A quiénes les toca por el anillo. */
  esperados: ClienteMotRest[];
  /** Quiénes ya la reportan. */
  actualizados: ClienteMotRest[];
  /** Les tocaba y siguen en otra versión. */
  rezagados: { cliente: ClienteMotRest; version: string | null }[];
  /** De 0 a 100 sobre los esperados. */
  avance_pct: number;
}

/**
 * Cómo va la versión que se acaba de publicar.
 *
 * ESTE ERA EL AGUJERO DEL ANILLO. Antes de firmar se veía perfectamente a quién
 * le iba a tocar; después de firmar, nada. Un despliegue por anillos sin nadie
 * mirando el resultado es el mismo «publicar y rezar» de siempre, solo que más
 * despacio: si el canario se rompe y no se mira, la avería llega igual al resto
 * cuando se sube el porcentaje.
 */
export function adopcionDeVersion(
  clientes: readonly ClienteMotRest[],
  pulsos: readonly PulsoCliente[],
  version: string,
  anillo?: number,
  enElAnillo: (id: ID, anillo?: number) => boolean = () => true,
): AdopcionDeVersion {
  const porSucursal = new Map<ID, PulsoCliente>();
  for (const p of pulsos) {
    const previo = porSucursal.get(p.sucursal_id);
    if (!previo || p.ts > previo.ts) porSucursal.set(p.sucursal_id, p);
  }

  const esperados = clientes.filter((c) => c.activo && enElAnillo(c.id, anillo));
  const actualizados: ClienteMotRest[] = [];
  const rezagados: { cliente: ClienteMotRest; version: string | null }[] = [];

  for (const cliente of esperados) {
    const suya = porSucursal.get(cliente.id)?.version ?? null;
    if (suya === version) actualizados.push(cliente);
    else rezagados.push({ cliente, version: suya });
  }

  return {
    version,
    esperados,
    actualizados,
    rezagados,
    avance_pct: esperados.length === 0
      ? 0
      : Math.round((actualizados.length / esperados.length) * 100),
  };
}

// --- El acceso de soporte ---------------------------------------------------------------------

/**
 * Qué locales siguen aceptando la contraseña de soporte ANTERIOR.
 *
 * La contraseña de soporte no viaja sola: va firmada dentro de la licencia, así
 * que cambiarla en Central no cambia nada en ningún restaurante hasta que se le
 * emite una licencia nueva. El día que haya que rotarla —porque se filtró, o
 * porque se va alguien que la sabía— la pregunta urgente es exactamente ésta, y
 * hasta ahora no se podía contestar: había que reemitir a ciegas y confiar.
 */
export function localesConSoporteViejo(
  clientes: readonly ClienteMotRest[],
  soporte_fijado_ts: number | undefined,
): ClienteMotRest[] {
  if (!soporte_fijado_ts) return [];
  return clientes.filter(
    (cliente) =>
      cliente.activo &&
      (!cliente.licencia || cliente.licencia.emitida_ts < soporte_fijado_ts),
  );
}
