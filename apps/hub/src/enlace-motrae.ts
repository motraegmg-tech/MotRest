/**
 * Qué le pide el Hub a la nube de MOTRAE, sin decir quién la aloja.
 *
 * Esto era `relay.ts` y vivía junto a un transporte de WebSocket contra un
 * servidor propio en Fly. Ese servidor **ya no existe** —nunca llegó a
 * desplegarse del todo, y el dominio ni siquiera estaba registrado—, así que el
 * transporte se retiró entero y quedó solo la parte que no dependía de él.
 *
 * SI ESTO NO CONECTA, EL RESTAURANTE SIGUE VENDIENDO. Lo único que se pierde
 * son los avisos de WhatsApp y el parte de vida, y se recuperan al volver.
 */
import type { Aviso } from "./avisos.js";

/** Lo que un comensal escribió, ya atribuido a su restaurante. */
export interface MensajeDelComensal {
  sucursal_id: string;
  contacto: string;
  texto: string;
  externo_id: string;
  ts: number;
}

/**
 * El contrato del enlace con MOTRAE.
 *
 * Se conserva aunque hoy solo haya una implementación. Dice **qué le pedimos a
 * la nube**, y eso no depende de quién la aloje: el día que haya que mudarla,
 * lo que tenga que cumplir el sustituto está escrito aquí y no repartido por el
 * Hub.
 */
export interface EnlaceConMotrae {
  conectado(): boolean;
  conectar(): void;
  enviar(aviso: Aviso): void;
  reportarPulso(pulso: Record<string, unknown>): void;
  publicarCredenciales(cred: { phone_number_id: string; token: string; nombre: string }): void;
  desconectar(): void;
}

export interface OpcionesNube {
  /** `https://<proyecto>.supabase.co`, tal como viene en la licencia. */
  url: string;
  /** La llave publicable, incrustada al empaquetar. No es un secreto. */
  llavePublicable: string;
  /**
   * La credencial de ESTE restaurante, la que MOTRAE entregó al darlo de alta.
   *
   * No es una clave compartida: de ella sale la identidad del local ante la
   * nube. Por eso el `sucursal_id` no viaja en ninguna petición — la base de
   * datos no se cree lo que el Hub diga que es, lo lee del token que Supabase
   * Auth le firmó.
   */
  clave: string;
  sucursal_id: string;
  /** Credenciales de WhatsApp de ESTE restaurante, si ya las tiene. */
  credenciales?: { phone_number_id: string; token: string; nombre: string };
  alLlegarMensaje: (mensaje: MensajeDelComensal) => void;
  /**
   * Llega una licencia nueva de MOTRAE, sin que nadie la pegue en la caja.
   *
   * QUIEN DECIDE SI VALE ES EL HUB, no la nube. Lo que llega por aquí es un
   * documento firmado que se verifica contra la pública de MOTRAE compilada en
   * este binario, exactamente igual que si se hubiera pegado a mano. La nube es
   * un cartero: puede no entregar, pero no puede falsificar.
   */
  alLlegarLicencia?: (licencia: unknown) => Promise<{ ok: boolean; error?: string }>;
  alConectar?: () => void;
  registrar: (nivel: "info" | "aviso" | "error", texto: string) => void;
}
