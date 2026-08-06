/**
 * La licencia de uso de MotRest (F4).
 *
 * LA REGLA QUE MANDA SOBRE TODAS: NUNCA DEJAR AL RESTAURANTE SIN VENDER.
 *
 * Un POS que se apaga a media cena porque no pudo comprobar una licencia es una
 * catástrofe, y sería culpa de MOTRAE, no del restaurante. Da igual si fue el
 * internet del local, un servidor caído de nuestro lado o un reloj desfasado:
 * el comensal está esperando su cuenta y el mesero no puede cobrarle.
 *
 * De ahí sale todo el diseño:
 *
 *   1. **La licencia se comprueba SIN INTERNET.** Es un documento firmado que
 *      el Hub guarda y verifica solo. Sin llamadas al arrancar, sin depender de
 *      que MOTRAE esté en pie para que el restaurante abra.
 *
 *   2. **Vencer no es apagar.** Hay aviso mucho antes, después gracia con el
 *      sistema entero funcionando, y solo al final una restricción — que NUNCA
 *      impide cerrar el día ni sacar los datos.
 *
 *   3. **Los datos son del restaurante, siempre.** Aunque deba tres meses. Son
 *      sus ventas y las necesita para el SAT; retenerlas no es una palanca de
 *      cobro, es un problema legal. Exportar funciona en todos los estados.
 *
 * QUÉ SE RESTRINGE, ENTONCES. Lo que hace crecer la operación —abrir turno
 * nuevo, dar de alta terminales— y no lo que la cierra. Un restaurante que dejó
 * de pagar puede terminar su servicio, cobrar, cerrar su caja e imprimir su
 * corte. Lo que no puede es empezar otro día como si nada.
 */
import type { ID } from "../comun/ids.js";

export type Plan = "prueba" | "mensual" | "anual";

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
  /** Firma de MOTRAE sobre todo lo anterior. */
  firma: string;
}

export type EstadoLicencia =
  /** Todo en orden. */
  | "activa"
  /** Le quedan pocos días. Se avisa, sin estorbar. */
  | "por_vencer"
  /** Ya venció, pero está dentro de la gracia. TODO sigue funcionando. */
  | "gracia"
  /** Se acabó la gracia. Se puede cerrar el día y exportar, no empezar otro. */
  | "restringida"
  /** No hay licencia, o la firma no cuadra. */
  | "invalida";

/** Cuántos días antes se empieza a avisar. */
export const DIAS_AVISO = 10;
/** Gracia por defecto si la licencia no dice otra cosa. */
export const GRACIA_POR_DEFECTO = 7;

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
 * `verificada` la calcula quien tiene la llave pública; aquí solo se decide qué
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
          ? "Tu licencia de MotRest vence hoy."
          : `Tu licencia de MotRest vence en ${dias} ${dias === 1 ? "día" : "días"}.`,
    };
  }

  const diasVencida = -dias;
  if (diasVencida <= gracia) {
    const restan = gracia - diasVencida;
    return {
      estado: "gracia",
      dias,
      // TODO sigue funcionando. La gracia existe para que un pago que se atrasó
      // dos días no le cueste un viernes al restaurante.
      opera: true,
      avisar: true,
      mensaje:
        `Tu licencia venció hace ${diasVencida} ${diasVencida === 1 ? "día" : "días"}. ` +
        `El sistema sigue funcionando ${restan} ${restan === 1 ? "día" : "días"} más.`,
    };
  }

  return {
    estado: "restringida",
    dias,
    opera: false,
    avisar: true,
    mensaje:
      "Tu licencia de MotRest venció. Puedes cerrar tu caja, imprimir tus cortes y " +
      "exportar toda tu información, pero no abrir turnos nuevos hasta regularizar el pago.",
  };
}

/**
 * Lo que se puede hacer con la licencia en cada estado.
 *
 * Es una lista corta a propósito. Restringir de más convierte un cobro pendiente
 * en un restaurante parado, y eso destruye la relación mucho más rápido de lo
 * que la falta de pago la merece.
 */
export type AccionLicenciada =
  /** Abrir un turno de caja: es lo que arranca un día de operación. */
  | "abrir_turno"
  /** Dar de alta terminales nuevas. */
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
 * VENDER, CERRAR y EXPORTAR se pueden SIEMPRE, incluso sin licencia válida. No
 * es generosidad: un restaurante a media cena tiene comensales esperando su
 * cuenta, y sus ventas son suyas y las necesita para el SAT.
 */
export function permiteLicencia(
  situacion: SituacionLicencia,
  accion: AccionLicenciada,
): boolean {
  if (accion === "vender" || accion === "cerrar" || accion === "exportar") return true;
  return situacion.opera;
}

/** El texto que se firma. Cualquier cambio de un campo invalida la firma. */
export function contenidoFirmable(licencia: Omit<Licencia, "firma">): string {
  return [
    licencia.sucursal_id,
    licencia.nombre,
    licencia.plan,
    licencia.vence_ts,
    licencia.gracia_dias,
    licencia.emitida_ts,
  ].join("|");
}

/**
 * ¿La firma es de MOTRAE y corresponde a ESTE local?
 *
 * Dos comprobaciones, y las dos importan: sin la firma cualquiera se extiende su
 * licencia editando un archivo; sin el `sucursal_id`, la licencia de un
 * restaurante que sí paga serviría para todos los demás.
 */
export async function verificarLicencia(
  licencia: Licencia,
  sucursalEsperada: ID,
  llavePublica: string,
): Promise<boolean> {
  if (licencia.sucursal_id !== sucursalEsperada) return false;

  try {
    const llave = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(llavePublica),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const esperada = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        llave,
        new TextEncoder().encode(contenidoFirmable(licencia)),
      ),
    );
    const hex = [...esperada].map((b) => b.toString(16).padStart(2, "0")).join("");

    // Comparación de tiempo constante, igual que en el resto del sistema.
    const recibida = licencia.firma.toLowerCase();
    if (recibida.length !== hex.length) return false;

    let diferencia = 0;
    for (let i = 0; i < hex.length; i++) {
      diferencia |= hex.charCodeAt(i) ^ recibida.charCodeAt(i);
    }
    return diferencia === 0;
  } catch {
    return false;
  }
}

/** Emite una licencia firmada. Solo MOTRAE, que es quien tiene el secreto. */
export async function emitirLicencia(
  datos: Omit<Licencia, "firma">,
  secreto: string,
): Promise<Licencia> {
  const llave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(contenidoFirmable(datos))),
  );

  return {
    ...datos,
    firma: [...firma].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

/** El stream donde el Hub guarda su licencia. */
export function streamLicencia(sucursal_id: ID): ID {
  return `licencia:${sucursal_id}`;
}
