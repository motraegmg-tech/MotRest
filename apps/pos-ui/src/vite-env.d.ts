/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" = compilación para la web (Vercel): arranca en «Entra a tu restaurante». */
  readonly VITE_MOTREST_WEB?: string;
  /** La nube de MotRest (`https://<proyecto>.supabase.co`). Solo en la web. */
  readonly VITE_SUPABASE_URL?: string;
  /** La llave PUBLICABLE de esa nube. Nunca la de servicio. */
  readonly VITE_SUPABASE_PUBLICABLE?: string;
  /** La pública Ed25519 de licencias de MOTRAE, para verificar la licencia en modo nube. */
  readonly VITE_MOTREST_LICENCIA_PUBLICA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
