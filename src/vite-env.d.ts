/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_REPORT_AGENT_URL?: string
  readonly VITE_DATAQUERY_AGENT_URL?: string
  readonly VITE_DEEP_AGENT_URL?: string
  readonly VITE_INTENT_AGENT_URL?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }