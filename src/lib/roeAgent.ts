// src/lib/roeAgent.ts
const BASE = import.meta.env.VITE_ROE_AGENT_URL as string;
const TOKEN = import.meta.env.VITE_ROE_AGENT_TOKEN as string | undefined;

export type Scope = {
  year: number;
  quarter?: string | null;
  company: string;
  scenario?: 'actual' | 'baseline';
  compare_to?: 'baseline' | 'last_year' | null;
};

export type AnalyzeResponse = {
  need_clarification?: boolean;
  ask?: string | null;
  method?: 'ratio' | 'dupont' | null;
  roe?: number | null;
  components?: Record<string, number> | null;
  total_change?: number | null;
  table?: Array<Record<string, any>> | null;
  chart_png_b64?: string | null;
  conclusion?: string | null;
};

const headers = () => ({
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
});

export async function nlqAsk(question: string, scope?: Scope, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/nlq`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ question, scope }),
    signal,
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as AnalyzeResponse;
}
