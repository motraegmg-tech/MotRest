import { createClient } from "@supabase/supabase-js";

// La URL de Supabase y la Service Role Key son secretas y deben configurarse
// en las variables de entorno de Vercel.
// NUNCA usar la llave anónima pública aquí, pues el portal necesita saltarse
// RLS para leer `tickets_facturables` e insertar en `solicitudes_de_factura`
// a nombre de cualquier sucursal.

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
