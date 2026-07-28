/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'static' (default) = seeded demo data; 'live' = empty, user-populated. */
  readonly VITE_DATA_SOURCE?: string;
  /** Display name of the live instance's bootstrap administrator. */
  readonly VITE_ADMIN_NAME?: string;
  /** Email of the live instance's bootstrap administrator. */
  readonly VITE_ADMIN_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
