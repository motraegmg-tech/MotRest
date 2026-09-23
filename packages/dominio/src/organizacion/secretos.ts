/**
 * Los secretos del restaurante que viven SOLO en su Hub.
 *
 * Dos, de momento, y los dos con el mismo problema: tienen que poder
 * capturarse desde Central (Gonzalo, para toda la cartera) o desde la caja del
 * propio local, y en ningún caso pueden acabar en una tableta ni en la nube en
 * claro.
 *
 * - **FacturAPI**: la llave de la organización del restaurante. Con ella se
 *   timbra a su nombre ante el SAT.
 * - **Gmail**: la contraseña de aplicación con la que salen los correos al
 *   comensal desde la cuenta del propio restaurante.
 *
 * Aquí está el CONTRATO, compartido por Central, el Hub y la caja: qué viaja
 * dentro del sobre, qué estado se puede enseñar sin revelar nada, y quién
 * puede cambiarlos. Decidido con Gonzalo el 19-sep-2026.
 */
import type { Usuario } from "../identidad/roles.js";

export type ClaseSecreto = "facturapi" | "gmail";

export const CLASES_SECRETO = ["facturapi", "gmail"] as const satisfies readonly ClaseSecreto[];

/** Pruebas timbra sin validez fiscal (llave `sk_test_`); producción, de verdad. */
export type ModoFacturapi = "pruebas" | "produccion";

/** De dónde salió el valor vigente. Se enseña en los dos lados. */
export type OrigenSecreto = "central" | "local";

interface ComunSecreto {
  /** A qué restaurante va. El Hub rechaza un sobre que no sea suyo. */
  sucursal_id: string;
  /**
   * Cuándo se decidió. GANA EL MÁS RECIENTE, venga de Central o de la caja:
   * Gonzalo pidió que lo que se configure en un lado aparezca en el otro, y la
   * única regla que no sorprende a nadie es que la última palabra sea la
   * última que se dijo.
   */
  emitido_ts: number;
  origen: OrigenSecreto;
}

export interface SecretoFacturapi extends ComunSecreto {
  clase: "facturapi";
  /** `sk_live_…` o `sk_test_…`, según el modo. */
  llave: string;
  modo: ModoFacturapi;
  /** La organización de FacturAPI, si se eligió desde Central. */
  organizacion_id?: string;
  organizacion_nombre?: string;
}

export interface SecretoGmail extends ComunSecreto {
  clase: "gmail";
  /** Contraseña de aplicación de 16 letras que da Google. */
  contrasena: string;
  /** La cuenta desde la que salen los correos, si se captura junto. */
  remitente?: string;
}

/** Lo que va DENTRO del sobre (y por el canal de la caja al Hub). */
export type Secreto = SecretoFacturapi | SecretoGmail;

/**
 * Lo único que se enseña de un secreto: sus cuatro últimos caracteres.
 *
 * Basta para que Gonzalo y el responsable confirmen que hablan de la misma
 * llave sin dictarla, y no sirve de nada a quien lo vea por encima del hombro.
 */
export function terminacion(valor: string): string {
  const limpio = valor.trim();
  return limpio.length > 8 ? limpio.slice(-4) : "";
}

/** El estado de la facturación que el Hub reporta a Central y a la caja. */
export interface EstadoFacturapi {
  configurada: boolean;
  modo?: ModoFacturapi;
  termina_en?: string;
  origen?: OrigenSecreto;
  actualizado_ts?: number;
  organizacion_id?: string;
  /** Lo que FacturAPI dice de la organización al probar la llave. */
  razon_social?: string;
  rfc?: string;
  /** ISO. Cuándo vence el CSD que está cargado en FacturAPI. */
  csd_vence?: string;
  /** `is_production_ready` de FacturAPI. */
  lista?: boolean;
  /** Los `pending_steps` de FacturAPI, tal cual los da. */
  pendientes?: string[];
  /** El último problema al probarla o al usarla, en palabras de persona. */
  error?: string;
}

export interface EstadoGmail {
  configurada: boolean;
  termina_en?: string;
  origen?: OrigenSecreto;
  actualizado_ts?: number;
  remitente?: string;
  error?: string;
}

export interface EstadoSecretos {
  facturapi: EstadoFacturapi;
  gmail: EstadoGmail;
}

/**
 * ¿Puede esta persona capturar o cambiar un secreto del Hub?
 *
 * POR ROL, NO POR PERMISO. Gonzalo lo pidió así: solo el responsable del
 * restaurante (rol propietario) y el acceso de soporte de MOTRAE, «otro usuario
 * no». Un permiso se puede conceder a mano desde Usuarios; si esto dependiera
 * de uno, el responsable podría pasárselo al cajero sin darse cuenta de que le
 * está dando la llave para facturar a nombre del negocio.
 */
export function puedeGuardarSecretos(usuario: Pick<Usuario, "rol_id" | "activo"> | null | undefined): boolean {
  if (!usuario || !usuario.activo) return false;
  return usuario.rol_id === "propietario" || usuario.rol_id === "soporte";
}

/** ¿El valor tiene la forma de una llave de FacturAPI para ese modo? */
export function llaveFacturapiValida(llave: string, modo: ModoFacturapi): boolean {
  const prefijo = modo === "produccion" ? "sk_live_" : "sk_test_";
  const limpia = llave.trim();
  return limpia.startsWith(prefijo) && limpia.length >= prefijo.length + 16 && !/\s/.test(limpia);
}

/**
 * ¿Tiene la forma de una contraseña de aplicación de Google?
 *
 * Google la enseña en cuatro grupos de cuatro letras con espacios; se aceptan
 * con o sin ellos, y se guardan sin ellos.
 */
export function normalizarContrasenaGmail(texto: string): string | null {
  const limpia = texto.replace(/\s+/g, "");
  return /^[a-zA-Z]{16}$/.test(limpia) ? limpia.toLowerCase() : null;
}

/**
 * El acceso web del restaurante (1.6.0), en el mismo buzón pero APARTE.
 *
 * No entra en `Secreto` ni en `ClaseSecreto` a propósito: esos alimentan las
 * pantallas de FacturAPI y Gmail, el semáforo de Central y lo que se captura
 * desde la caja. La clave remota no se enseña, no se captura a mano y no tiene
 * «terminación»: solo la manda Central, y el Hub la usa para abrir el túnel.
 *
 * `version` sube cada vez que cambia la contraseña web. Al verla subir, el Hub
 * corta las sesiones web que tenía abiertas.
 */
export interface SecretoAccesoWeb {
  clase: "acceso_web";
  sucursal_id: string;
  emitido_ts: number;
  origen: "central";
  clave_remota: string;
  version: number;
}

/** Todo lo que puede llegar en un sobre del buzón. */
export type ClaseBuzon = ClaseSecreto | "acceso_web";

export function esSecretoAccesoWeb(valor: unknown): valor is SecretoAccesoWeb {
  if (!valor || typeof valor !== "object") return false;
  const s = valor as Record<string, unknown>;
  return (
    s.clase === "acceso_web" &&
    typeof s.sucursal_id === "string" &&
    typeof s.emitido_ts === "number" &&
    s.origen === "central" &&
    typeof s.clave_remota === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(s.clave_remota) &&
    typeof s.version === "number" &&
    Number.isInteger(s.version) &&
    s.version >= 1
  );
}

/** Revisa un secreto recién abierto antes de darlo por bueno. */
export function esSecreto(valor: unknown): valor is Secreto {
  if (!valor || typeof valor !== "object") return false;
  const s = valor as Record<string, unknown>;
  if (typeof s.sucursal_id !== "string" || typeof s.emitido_ts !== "number") return false;
  if (s.origen !== "central" && s.origen !== "local") return false;
  if (s.clase === "facturapi") {
    return (
      (s.modo === "pruebas" || s.modo === "produccion") &&
      typeof s.llave === "string" &&
      llaveFacturapiValida(s.llave, s.modo)
    );
  }
  if (s.clase === "gmail") {
    return typeof s.contrasena === "string" && normalizarContrasenaGmail(s.contrasena) !== null;
  }
  return false;
}
