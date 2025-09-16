// src/lib/dataServiceV2.ts
export type SensitivityRow = {
  company_name: string;
  canonical_metric: string;
  factor_name: string;
  elasticity_value: number | null;
  lag_quarters: number;
  shock_unit: 'percent' | 'abs' | 'bp';
  source_method?: string;
  note?: string;
  seasonal_adjust?: boolean | null;
  seasonality_source?: string | null;
  seasonality_note?: string | null;
  seasonality_q1?: number | null;
  seasonality_q2?: number | null;
  seasonality_q3?: number | null;
  seasonality_q4?: number | null;
};

const BASE =
  import.meta.env.VITE_SIMULATION_AGENT_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  '';

const TOKEN = import.meta.env.VITE_SIMULATION_AGENT_TOKEN || '';
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

// 只在模块加载时打印一次，便于你确认前端确实读到了 env
// （运行时可在浏览器控制台看到）
(() => {
  // eslint-disable-next-line no-console
  console.info('[SimulationV2] BASE=', BASE || '(empty)', ' token?', Boolean(TOKEN));
})();


async function jsonFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function seedSimulationV2(
  question: string,
  runId?: string,
  sessionUserId?: string | null
) {
  return jsonFetch<any>('/simulation_v2/seed', {
    method: 'POST',
    body: JSON.stringify({
      question,
      run_id: runId ?? null,
      session_user_id: sessionUserId ?? null,
    }),
  });
}



export async function runSimulationV2(payload: {
  run_id: string;
  sensitivity_rows: SensitivityRow[];
  models: {
    arima: { enabled: boolean; p: number; d: number; q: number; periods: number };
    monte_carlo: { enabled: boolean; samples: number; quantiles: number[] };
  };
  horizon_quarters: number;
  session_user_id?: string | null;
  skip_report?: boolean;
  scenario_deltas?: { factor: string; optimistic: number; base: number; pessimistic: number; }[]; // 新增
}) {
  return jsonFetch<any>('/simulation_v2/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
// === 新增：保存 MD ===
export async function saveReportMdV2(run_id: string, md: string, uid?: string) {
  const AGENT_URL = (import.meta as any).env?.VITE_SIMULATION_AGENT_URL
    || (import.meta as any).env?.VITE_BACKEND_URL || '';
  const r = await fetch(`${AGENT_URL}/simulation_v2/save_md`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id, md, session_user_id: uid ?? null })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

// === 新增：美化渲染 MD ===
export async function beautifyReportMdV2(run_id: string, md: string) {
  const AGENT_URL = (import.meta as any).env?.VITE_SIMULATION_AGENT_URL
    || (import.meta as any).env?.VITE_BACKEND_URL || '';
  const r = await fetch(`${AGENT_URL}/simulation_v2/beautify_md`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run_id, md })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}




export async function uploadRunAttachment(runId: string, file: File) {
  const fd = new FormData();
  fd.append('run_id', runId);
  fd.append('file', file);
  const headers: Record<string, string> = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const r = await fetch(`${BASE}/simulation_v2/upload`, { method: 'POST', body: fd, headers });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}


export async function listRunHistory() {
  return jsonFetch<any>('/simulation_v2/history');
}

export async function listRunArtifacts(runId: string) {
  const params = new URLSearchParams({ run_id: runId });
  return jsonFetch<any>(`/simulation_v2/artifacts?${params.toString()}`);
}

export async function quickLookupSensitivity(company: string, metric: string, factor: string, runId?: string) {
  const params = new URLSearchParams({ company, metric, factor });
  if (runId) params.set('run_id', runId);
  return jsonFetch<any>(`/simulation_v2/lookup_sensitivity?${params.toString()}`);
}

