/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_POSTHOG_KEY?: string
  readonly VITE_POSTHOG_HOST?: string
  readonly VITE_POSTHOG_ENABLED?: string
  readonly VITE_POSTHOG_ENVIRONMENT?: 'development' | 'production'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
