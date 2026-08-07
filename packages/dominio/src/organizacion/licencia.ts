/**
 * La licencia de uso de MotRest (F4).
 *
 * CÓMO SE COBRA, QUE LO DECIDIÓ GONZALO: mensualidad por local. Vencida la
 * fecha hay **3 días de gracia** con todo funcionando, y al cuarto el software
 * queda **inservible**: una pantalla con el logo de MOTRAE y nada más. El
 * restaurante vuelve a hacer sus cosas a mano hasta que regularice.
 *
 * LO QUE SÍ SE COMPRUEBA SIN INTERNET. La licencia es un documento firmado que
 * el Hub guarda y verifica solo. No hay llamada a ningún servidor para abrir:
 * si MOTRAE se cae, los restaurantes que están al corriente siguen operando
 * como si nada. Depender de nuestra disponibilidad para que ellos vendan sería
 * cambiar un riesgo suyo por uno nuestro.
 *
 * LA ÚNICA CONCESIÓN, Y POR QUÉ EXISTE. El bloqueo no cae a media cena. Si en
 * el momento de vencer la gracia hay un TURNO DE CAJA ABIERTO, se difiere hasta
 * que ese turno cierre. No es suavizar el cobro: es que bloquear con doce mesas
 * abiertas deja ese dinero encerrado en una base de datos que nadie puede
 * abrir —el restaurante no puede ni cobrarles a los que están sentados— y esa
 * llamada de auxilio a las diez de la noche le cae a MOTRAE, no al moroso. Con
 * el diferimiento pierden igual el servicio siguiente, que es a las pocas
 * horas. Quien prefiera lo contrario lo enciende con `bloqueo_inmediato`.
 *
 * EL ACCESO DE SOPORTE VIAJA AQUÍ. La licencia lleva el hash de la credencial de
 * MOTRAE, y va dentro de lo firmado. Así el restaurante no puede fabricarse un
 * usuario con poderes de soporte editando un archivo, y MOTRAE puede entrar a
 * resolver un problema sin pedirle la contraseña a nadie. Ver `soporte.ts`.
 */
import { contenidoFirmableDe, firmar, verificar } from "../comun/firma.js";
import type { ID } from "../comun/ids.js";

export type Plan = "prueba" | "mensual" | "anual";

/**
 * La credencial de MOTRAE para este local, en forma de hash.
 *
 * NUNCA la contraseña en claro. Va aquí y no en el código porque la elige
 * Gonzalo en MOTRAE Central, y porque al ir dentro de lo firmado nadie puede
 * sustituirla por una suya.
 */
export interface CredencialSoporte {
  sal: string;
  hash: string;
  iteraciones: number;
}

/**
 * El documento firmado que MOTRAE emite. Viaja como texto y se guarda tal cual.
 *
 * No lleva nada del negocio del restaurante —ni ventas, ni clientes— porque no
 * hace falta y porque este archivo sí sale del local.
 */
export interface Licencia {
  /** A qué local pertenece. Copiarla a otro no sirve: no coincide. */
  sucursal_id: ID;
  /** Nombre del restaurante, solo para poder leerla. */
  nombre: string;
  plan: Plan;
  /** Hasta cuándo está pagada. */
  vence_ts: number;
  /** Días de tolerancia DESPUÉS de vencer, con todo funcionando. */
  gracia_dias: number;
  /** Cuándo se emitió. */
  emitida_ts: number;
  /** Credencial de soporte de MOTRAE para este local. */
  soporte?: CredencialSoporte;
  /**
   * true = el bloqueo cae en cuanto vence la gracia, aunque haya turno abierto.
   *
   * Apagado por defecto a propósito: ver la nota de arriba sobre lo que pasa
   * con las mesas abiertas.
   */
  bloqueo_inmediato?: boolean;
  /** Firma de MOTRAE sobre todo lo anterior. */
  firma: string;
}

export type EstadoLicencia =
  /** Todo en orden. */
  | "activa"
  /** Le quedan pocos días. Se avisa, sin estorbar. */
  | "por_vencer"
  /** Ya venció, pero está dentro de los 3 días. TODO sigue funcionando. */
  | "gracia"
  /** Se acabó la gracia: el software queda inservible. */
  | "bloqueada"
  /** No hay licencia, o la firma no cuadra. */
  | "invalida";

/** Cuántos días antes se empieza a avisar. */
export const DIAS_AVISO = 10;
/** Gracia por defecto: 3 días, decisión de Gonzalo. */
export const GRACIA_POR_DEFECTO = 3;

export interface SituacionLicencia {
  estado: EstadoLicencia;
  /** Días para vencer. Negativo = ya venció. */
  dias: number;
  /** Qué se le dice al restaurantero, en su idioma. */
  mensaje: string;
  /** true = se puede seguir operando con normalidad. */
  opera: boolean;
  /** true = hay que enseñarle el aviso sí o sí. */
  avisar: boolean;
}

const DIA_MS = 86_400_000;

/**
 * En qué situación está la licencia.
 *
 * `verificada` la calcula quien tiene la llave; aquí solo se decide qué
 * significa. Separarlo permite probar TODA la lógica de estados sin criptografía
 * de por medio, que es donde de verdad se cometen los errores.
 */
export function situacionDe(
  licencia: Licencia | null,
  verificada: boolean,
  ahora = Date.now(),
): SituacionLicencia {
  if (!licencia || !verificada) {
    return {
      estado: "invalida",
      dias: 0,
      opera: false,
      avisar: true,
      mensaje:
        "Este equipo no tiene una licencia válida de MotRest. Contacta a MOTRAE para activarlo.",
    };
  }

  const dias = Math.floor((licencia.vence_ts - ahora) / DIA_MS);
  const gracia = licencia.gracia_dias ?? GRACIA_POR_DEFECTO;

  if (dias > DIAS_AVISO) {
    return { estado: "activa", dias, opera: true, avisar: false, mensaje: "" };
  }

  if (dias >= 0) {
    return {
      estado: "por_vencer",
      dias,
      opera: true,
      avisar: true,
      mensaje:
        dias === 0
          ? "Su licencia de MotRest vence hoy."
          : `Su licencia de MotRest vence en ${dias} ${dias === 1 ? "día" : "días"}.`,
    };
  }

  const diasVencida = -dias;
  if (diasVencida <= gracia) {
    const restan = gracia - diasVencida;
    return {
      estado: "gracia",
      dias,
      /*
       * TODO sigue funcionando. La gracia es corta —tres días— pero mientras
       * dura no estorba en absoluto: un aviso que bloquea a medias es lo peor
       * de los dos mundos, porque ni cobra ni deja trabajar.
       */
      opera: true,
      avisar: true,
      mensaje:
        `Su licencia venció hace ${diasVencida} ${diasVencida === 1 ? "día" : "días"}. ` +
        (restan === 0
          ? "Hoy es el último día: mañana el sistema deja de funcionar."
          : `Le ${restan === 1 ? "queda" : "quedan"} ${restan} ${restan === 1 ? "día" : "días"} antes de que el sistema deje de funcionar.`),
    };
  }

  return {
    estado: "bloqueada",
    dias,
    opera: false,
    avisar: true,
    mensaje:
      "Su licencia de MotRest venció y el sistema quedó suspendido. " +
      "En cuanto se registre el pago vuelve a funcionar con toda su información intacta.",
  };
}

/**
 * Lo que se puede hacer con la licencia en cada estado.
 *
 * Bloqueada no se puede NADA. Es lo que decidió Gonzalo y es lo que hace que la
 * mensualidad se cobre: un bloqueo con excepciones es un bloqueo que se ignora.
 */
export type AccionLicenciada =
  | "abrir_turno"
  | "agregar_terminal"
  /** Vender: capturar, enviar a cocina, cobrar. */
  | "vender"
  /** Cerrar caja, imprimir el corte. */
  | "cerrar"
  /** Sacar sus datos. */
  | "exportar";

/**
 * ¿Esta acción se puede con la licencia en este estado?
 *
 * NADA DE EXCEPCIONES CUANDO ESTÁ BLOQUEADA. El único matiz —el turno abierto—
 * no vive aquí sino en `momentoDeBloquear`, porque no es una excepción al
 * bloqueo: es CUÁNDO empieza.
 *
 * Sobre sus datos: el restaurante no puede exportarlos con el sistema
 * bloqueado, pero MOTRAE se los entrega desde Central en cuanto los pida. Sus
 * ventas son suyas y las necesita para el SAT; retenerlas no sería una palanca
 * de cobro, sería un problema legal. Lo que se suspende es el uso del software,
 * no la propiedad de la información.
 */
export function permiteLicencia(
  situacion: SituacionLicencia,
  _accion: AccionLicenciada,
): boolean {
  return situacion.opera;
}

/**
 * ¿Cuándo cae el bloqueo?
 *
 * Con un turno de caja abierto se difiere al cierre, salvo que la licencia diga
 * lo contrario. Bloquear con mesas abiertas encierra ese dinero: el restaurante
 * no puede cobrarle ni a los que están sentados, y esa llamada de auxilio le
 * llega a MOTRAE. Difiriendo, pierden igual el servicio siguiente.
 */
export type MomentoBloqueo = "ahora" | "al_cerrar_turno";

export function momentoDeBloquear(
  situacion: SituacionLicencia,
  hayTurnoAbierto: boolean,
  licencia?: Licencia | null,
): MomentoBloqueo {
  if (situacion.estado !== "bloqueada") return "ahora";
  if (licencia?.bloqueo_inmediato) return "ahora";
  return hayTurnoAbierto ? "al_cerrar_turno" : "ahora";
}

/**
 * ¿Hay que enseñar la pantalla de bloqueo AHORA MISMO?
 *
 * Es la pregunta que hace la aplicación en cada arranque y en cada cierre de
 * turno. Junta el estado y el momento en un solo sí/no para que ninguna
 * pantalla tenga que volver a razonarlo por su cuenta.
 */
export function debeBloquearse(
  situacion: SituacionLicencia,
  hayTurnoAbierto: boolean,
  licencia?: Licencia | null,
): boolean {
  if (situacion.opera) return false;
  return momentoDeBloquear(situacion, hayTurnoAbierto, licencia) === "ahora";
}

/**
 * El texto que se firma. Cualquier cambio de cualquier campo invalida la firma.
 *
 * Es el objeto ENTERO serializado canónicamente, no una lista de campos escrita
 * a mano. Antes era `[...].join("|")` y eso tenía tres agujeros: un campo nuevo
 * quedaba fuera de la firma en silencio, un `nombre` con `|` podía colisionar, y
 * `soporte` ausente producía la misma cadena que `soporte` vacío.
 */
export function contenidoFirmable(licencia: Omit<Licencia, "firma">): string {
  return contenidoFirmableDe(licencia);
}

/**
 * ¿La firma es de MOTRAE y corresponde a ESTE local?
 *
 * Dos comprobaciones, y las dos importan: sin la firma cualquiera se extiende su
 * licencia editando un archivo; sin el `sucursal_id`, la licencia de un
 * restaurante que sí paga serviría para todos los demás.
 *
 * `llaveDeVerificacion` es la **pública** de MOTRAE, y ahora el nombre dice la
 * verdad: antes se llamaba `llavePublica` y era el secreto simétrico con el que
 * también se firmaba. Ese nombre engañoso es probablemente el origen del error.
 * Que se filtre esta llave no permite emitir ni una licencia.
 */
export async function verificarLicencia(
  licencia: Licencia,
  sucursalEsperada: ID,
  llaveDeVerificacion: string,
): Promise<boolean> {
  if (licencia.sucursal_id !== sucursalEsperada) return false;

  const { firma, ...sinFirma } = licencia;
  return verificar(llaveDeVerificacion, contenidoFirmable(sinFirma), firma);
}

/**
 * Emite una licencia firmada. Solo MOTRAE, que es quien tiene la llave privada.
 *
 * Esa privada **no sale de MOTRAE Central**. Antes esta misma llave se instalaba
 * en cada restaurante para poder verificar, así que cualquier cliente podía
 * emitirse licencias — y firmar actualizaciones para toda la flota.
 */
export async function emitirLicencia(
  datos: Omit<Licencia, "firma">,
  llavePrivada: string,
): Promise<Licencia> {
  return { ...datos, firma: await firmar(llavePrivada, contenidoFirmable(datos)) };
}

/**
 * Cuándo vence una mensualidad que se paga hoy.
 *
 * Se cuenta desde el vencimiento anterior si todavía no ha pasado, y desde hoy
 * si ya pasó. Así, pagar tres días antes no regala tres días, y pagar tarde no
 * cobra los días que el restaurante estuvo bloqueado.
 */
export function siguienteVencimiento(
  vencimientoActual: number | null,
  plan: Plan,
  ahora = Date.now(),
): number {
  const meses = plan === "anual" ? 12 : 1;
  const base = vencimientoActual && vencimientoActual > ahora ? vencimientoActual : ahora;
  const fecha = new Date(base);
  fecha.setMonth(fecha.getMonth() + meses);
  return fecha.getTime();
}

/** El stream donde el Hub guarda su licencia. */
export function streamLicencia(sucursal_id: ID): ID {
  return `licencia:${sucursal_id}`;
}
