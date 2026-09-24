/**
 * La nube de MotRest vista desde la web (1.6.0).
 *
 * Un solo cliente de Supabase para toda la página: la sesión del restaurante,
 * el túnel al Hub (modalidad «ambas») y las tablas cifradas (modalidad «nube»)
 * cuelgan del mismo pase, que se renueva solo.
 *
 * Solo lo importa el código de la web, y siempre de forma diferida: la caja y
 * las tabletas del salón no cargan ni una línea de esto.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Dónde guarda supabase-js el pase del restaurante en este navegador. */
export const LLAVE_SESION_WEB = "motrest.web.sesion";

let cliente: SupabaseClient | null = null;

export function direccionNube(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/[/]+$/, "");
  if (!/^https:\/\//.test(url)) {
    throw new Error("Esta compilación de la web no sabe dónde está la nube (VITE_SUPABASE_URL).");
  }
  return url;
}

export function llavePublicable(): string {
  const llave = (import.meta.env.VITE_SUPABASE_PUBLICABLE ?? "").trim();
  if (!llave) throw new Error("Esta compilación de la web no trae la llave publicable de la nube.");
  return llave;
}

export function nube(): SupabaseClient {
  cliente ??= createClient(direccionNube(), llavePublicable(), {
    auth: {
      persistSession: true,
      storageKey: LLAVE_SESION_WEB,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cliente;
}
