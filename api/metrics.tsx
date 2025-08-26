// api/metrics.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 只在服务端读取，别放到 VITE_*（那会进浏览器）
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

    // 优先用 service_role（有 RLS 写/读权限）；如你只读且 RLS 已放行，可仅用 anon
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE || SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    // 通用读取参数（你可按需扩展）
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { table, select = '*', match = {}, order, limit = 200 } = body;

    if (!table) return res.status(400).json({ error: 'table is required' });

    let q = supabase.from(table).select(select);
    Object.entries(match).forEach(([k, v]) => { q = q.eq(k as string, v as any); });
    if (order?.column) q = q.order(order.column, { ascending: !!order.ascending });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'server error' });
  }
}
