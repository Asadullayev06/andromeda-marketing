/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin in production, e.g. https://api-marketing.andromeda-ai.uz.
   *  Unset in dev → the client falls back to '/api' (proxied by Vite). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
