#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FreeReports Agent
- 输入：自然语言 prompt + (可选) 已上传文件 ID 列表（来自表 report_uploads）
- 解析：读取 Supabase Storage 'uploads' 对象，按类型抽取文本/表格摘要（PDF/Word/Excel/CSV/TXT/HTML）
- 可选：Google CSE 检索政策/行业上下文（GOOGLE_API_KEY / GOOGLE_CSE_ID）
- 输出：严谨 Markdown（包含 ```echarts {...}```），前端可一键送往 beautifyreport_agent 导出 HTML/DOCX/PDF

ENV（与现有保持一致）：
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  REPORT_AGENT_TOKEN=dev-secret-01
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o
  GOOGLE_API_KEY=...(可选)
  GOOGLE_CSE_ID=...(可选)
"""

import os, io, uuid, re, json, math, logging, traceback
import datetime as dt
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client

# 解析依赖
import pandas as pd
from docx import Document as Docx
from pypdf import PdfReader

# LLM
from openai import OpenAI
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import Request

logger = logging.getLogger("freereports")
logger.setLevel(logging.INFO)
# 可选：统一到控制台
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_h)

# 调试总开关：FREEREPORTS_DEBUG=1 打开
DEBUG = (os.getenv("FREEREPORTS_DEBUG", "0") == "1")
def dbg(msg: str, *args):
    if DEBUG:
        try:
            print("DBG " + (msg % args if args else msg), flush=True)
        except Exception:
            print("DBG " + msg, flush=True)


# ===== 环境变量 =====
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY", "")
REPORT_AGENT_TOKEN = os.getenv("REPORT_AGENT_TOKEN", "dev-secret-01")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
if not OPENAI_BASE_URL.endswith("/v1"):
    OPENAI_BASE_URL += "/v1"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "")

DATAQUERY_BASE_URL = (
    os.getenv("VITE_DATA_AGENT_URL")
    or os.getenv("DATAQUERY_BASE_URL")
    or "http://127.0.0.1:18010"
).rstrip("/")
DATAQUERY_TOKEN = os.getenv("VITE_DATAQUERY_AGENT_TOKEN") or os.getenv("DATAQUERY_TOKEN") or ""

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY")

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
llm = OpenAI(api_key=OPENAI_API_KEY or None, base_url=OPENAI_BASE_URL)

# ===== FastAPI =====
app = FastAPI(title="FreeReports Agent", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
logger.info("DATAQUERY_BASE_URL=%s token=%s", DATAQUERY_BASE_URL, "on" if DATAQUERY_TOKEN else "off")
@app.middleware("http")
async def _reqlog(request: Request, call_next):
    # 看到这行就说明 freereports 的路由层确实被访问到了
    print(f"[freereports] → {request.method} {request.url.path}", flush=True)
    resp = await call_next(request)
    print(f"[freereports] ← {resp.status_code} {request.method} {request.url.path}", flush=True)
    return resp
# ===== 鉴权 =====
def auth_check(authorization: Optional[str] = Header(None), x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token")):
    token = REPORT_AGENT_TOKEN
    if not token:
        return True
    bearer_ok = (authorization or "").startswith("Bearer ") and authorization.split(" ",1)[1] == token
    header_ok = (x_agent_token or "").startswith("Bearer ") and (x_agent_token.split(" ",1)[1] == token)
    if not (bearer_ok or header_ok):
        raise HTTPException(401, "Missing or invalid token")
    return True
@app.on_event("startup")
def _startup_dbg():
    print(f"[freereports] DEBUG={os.getenv('FREEREPORTS_DEBUG')} "
          f"PYTHONUNBUFFERED={os.getenv('PYTHONUNBUFFERED')} "
          f"DATAQUERY_BASE_URL={DATAQUERY_BASE_URL}", flush=True)

# ===== DTO =====
class NLGeneratePayload(BaseModel):
    prompt: str
    language: Optional[str] = "zh"
    allow_web_search: Optional[bool] = True
    selected_file_ids: Optional[List[str]] = None  # report_uploads.id 列表
    template_file_id: Optional[str] = None        # ✅ 新增：模板文件（上传中心里的文件ID）
    template_text: Optional[str] = None           # ✅ 新增：直接传入的模板原文
    meta: Optional[Dict[str, Any]] = None         # ✅ 新增：{company_name, period, locale, tone, chart_style}

# ===== 小工具 =====
# === 数据：从 financial_metrics 拉某公司在起止区间内的全部指标 ===
def _norm_quarter(v) -> str:
    s = str(v).strip().upper()
    if s.startswith("Q"):
        try:
            return f"Q{int(s[1:])}"
        except Exception:
            return "Q1"
    try:
        n = int(float(s))
    except Exception:
        n = 1
    if n < 1 or n > 4:
        n = 1
    return f"Q{n}"

def _period_key(y: int, q: str) -> int:
    mp = {"Q1":1, "Q2":2, "Q3":3, "Q4":4}
    return int(y) * 10 + mp.get(q.upper(), 1)

def _parse_meta_period(meta: dict):
    """接受多种写法:
       meta = { company_name, period: {start:{year,quarter}, end:{year,quarter}} }
       或 meta = { company_name, start_year, start_quarter, end_year, end_quarter }
    """
    m = meta or {}
    company = (m.get("company_name") or m.get("company") or "").strip()
    if isinstance(m.get("period"), dict):
        s = m["period"].get("start", {})
        e = m["period"].get("end", {})
        sy, sq = int(s.get("year", 0) or 0), _norm_quarter(s.get("quarter", "Q1"))
        ey, eq = int(e.get("year", 0) or 0), _norm_quarter(e.get("quarter", "Q1"))
    else:
        sy, sq = int(m.get("start_year", 0) or 0), _norm_quarter(m.get("start_quarter", "Q1"))
        ey, eq = int(m.get("end_year", 0) or 0), _norm_quarter(m.get("end_quarter", "Q1"))
    if not sy or not ey:
        return company, None, None
    return company, (sy, sq), (ey, eq)

def fetch_financial_metrics_all(company: str, start: tuple, end: tuple) -> pd.DataFrame:
    """读指定公司在起止年季间的所有指标（不过滤 metric_name）"""
    if not company or not start or not end:
        return pd.DataFrame()
    years = list(range(start[0], end[0] + 1))
    res = (
        sb.table("financial_metrics")
          .select("company_name, year, quarter, metric_name, metric_value")
          .eq("company_name", company)
          .in_("year", years)
          .limit(50000)
          .execute()
    )
    df = pd.DataFrame(getattr(res, "data", []) or [])
    if df.empty:
        return df
    df["year"] = df["year"].astype(int)
    df["quarter"] = df["quarter"].apply(_norm_quarter)
    df["pkey"] = df.apply(lambda r: _period_key(int(r["year"]), r["quarter"]), axis=1)
    p_start = _period_key(start[0], start[1])
    p_end   = _period_key(end[0],   end[1])
    df = df[(df["pkey"] >= p_start) & (df["pkey"] <= p_end)].copy()
    df.sort_values(["metric_name", "year", "quarter"], inplace=True)
    return df

FOCUS_MARKERS = re.compile(r"(特别关注|重点关注|重点|尤其|着重|优先)", re.I)
DEFAULT_KPIS = ["营业收入", "归母净利润", "毛利率", "净利率", "ROE", "资产负债率", "经营活动现金流净额"]

def _extract_focus_metrics(text: str, limit: int = 8) -> List[str]:
    """从包含‘重点/特别关注’的上下文窗口内抽指标，优先级更高"""
    if not text:
        return []
    wins = []
    for m in FOCUS_MARKERS.finditer(text):
        s = max(0, m.start() - 60)
        e = min(len(text), m.end() + 60)
        wins.append(text[s:e])
    focused: List[str] = []
    seen = set()
    for w in wins:
        cand = _extract_metrics_from_text(w, limit=limit)
        for c in cand:
            if c not in seen:
                seen.add(c)
                focused.append(c)
    return focused[:limit]

def summarize_timeseries(df: pd.DataFrame) -> dict:
    """与 report_agent 同口径：输出每个指标的时序 + 最新值/环比/同比"""
    out = {}
    if df.empty:
        return out
    for name, grp in df.groupby("metric_name"):
        grp = grp.sort_values(["year", "pkey"])
        series = [
            {
                "period": f"{int(r.year)}{r.quarter}",
                "year": int(r.year),
                "quarter": r.quarter,
                "value": r.metric_value,
            }
            for r in grp.itertuples(index=False)
        ]
        last = series[-1]["value"] if series else None
        prev = series[-2]["value"] if len(series) > 1 else None
        yoy = None
        if len(series) >= 5:
            base = series[-5]["value"]
            yoy = None if base in (None, 0) else (last - base) / base
        qoq = None if prev in (None, 0) else (last - prev) / prev
        out[name] = {"series": series, "latest": last, "qoq": qoq, "yoy": yoy}
    return out

def _safe_text(s: str, max_len: int = 12000) -> str:
    if not s: return ""
    s = re.sub(r"\s+", " ", s).strip()
    return s[:max_len]
# ====== Metric/Company 词表 & 轻量抽取 ======
def _load_metric_aliases() -> Dict[str, List[str]]:
    """{canonical_name: [aliases...]}"""
    try:
        rows = sb.table("metric_alias_catalog").select("canonical_name,aliases").execute().data or []
        out = {}
        for r in rows:
            als = r.get("aliases")
            if isinstance(als, str):
                try: als = json.loads(als.replace("{","[").replace("}","]"))
                except Exception: als = [x.strip() for x in re.split(r"[,\|/;；，、\s]+", als.strip("{}")) if x.strip()]
            if not isinstance(als, list): als = []
            out[str(r["canonical_name"])] = [str(a).strip() for a in als if str(a).strip()]
        return out
    except Exception:
        return {}

def _extract_metrics_from_text(text: str, limit: int = 12) -> List[str]:
    """在 prompt/模板标题/附件里扫描出现过的指标名或别名"""
    if not text: return []
    catalog = _load_metric_aliases()
    t = re.sub(r"\s+", "", text.lower())
    scored = []
    for canonical, als in catalog.items():
        names = [canonical.lower(), *[a.lower() for a in als]]
        score = 0
        for n in names:
            if not n: continue
            if n in t:
                score = max(score, len(n))
        if score > 0:
            scored.append((score, canonical))
    scored.sort(reverse=True)
    return [c for _, c in scored[:limit]]

def _parse_year_quarter_from_text(text: str) -> tuple[int|None, int|None]:
    """
    解析 2025Q1 / 2025年一季 / 2025年3月 等，月映射到季度
    """
    if not text: return (None, None)
    y = None; q = None
    m = re.search(r"(20\d{2})\s*Q\s*([1-4])", text, re.I)
    if not m:
        m = re.search(r"(20\d{2})\s*年?\s*([一二三四1234])\s*季", text)
    if m:
        y = int(m.group(1)); part = m.group(2)
        mp = {"一":"1","二":"2","三":"3","四":"4"}
        q = int(mp.get(part, part))
        return (y, q)
    # 月份 → 季度
    m2 = re.search(r"(20\d{2})\s*年?\s*([1-9]|1[0-2])\s*月", text)
    if m2:
        y = int(m2.group(1)); mon = int(m2.group(2)); q = (mon-1)//3 + 1
        return (y, q)
    return (None, None)

# ====== DataQuery 调用（并发） ======
def _dq_headers():
    h = {"Content-Type": "application/json"}
    if DATAQUERY_TOKEN:
        h["Authorization"] = f"Bearer {DATAQUERY_TOKEN}"
    return h

def _dq_call_one(task):
    url = f"{DATAQUERY_BASE_URL}/metrics/query"
    payload = {
        "metric": task.get("metric"),
        "company": task.get("company"),
        "year": task.get("year"),
        "quarter": (f"Q{task['quarter']}" if isinstance(task.get("quarter"), int) else task.get("quarter")),
        "question": task.get("question")
    }
    print(f"[freereports] DQ_REQ → {url} {json.dumps(payload, ensure_ascii=False)}", flush=True)  # ★新增
    try:
        r = requests.post(url, headers=_dq_headers(), json=payload, timeout=25)
        print(f"[freereports] DQ_RES ← {r.status_code} {r.text[:400]}", flush=True)    
        return r.json() if r.ok else {"need_clarification": True, "ask": f"dataquery错误: {r.status_code}"}
    except Exception as e:
        print(f"DBG DQ_ERR {e}", flush=True)
        return {"need_clarification": True, "ask": f"dataquery异常: {e}"}


def _dq_call_batch(tasks: List[Dict[str,Any]], max_workers: int = 8) -> List[Dict[str,Any]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed
    if not tasks: return []
    out = [None]*len(tasks)
    with ThreadPoolExecutor(max_workers=min(max_workers, len(tasks))) as ex:
        futs = {ex.submit(_dq_call_one, t): i for i, t in enumerate(tasks)}
        for f in as_completed(futs):
            out[futs[f]] = f.result()
    return out

def _build_db_metrics_from_dq(dq_results: List[Dict[str,Any]]) -> Dict[str, Any]:
    """
    转成 freereports 的 db_metrics 结构：{metric: {latest, qoq, yoy, unit}}
    - 直取：从 value.metric_value / indicator_card 计算 qoq/yoy
    - 公式：从 formula.result 取 latest（没有指标卡，qoq/yoy 留空）
    """
    agg: Dict[str, Any] = {}
    for r in dq_results or []:
        val_block = r.get("value") or {}
        formula_block = r.get("formula") or {}

        # 指标名优先：value.metric_name -> resolved.metric_canonical
        metric = val_block.get("metric_name") or ((r.get("resolved") or {}).get("metric_canonical"))
        if not metric:
            continue

        unit = val_block.get("unit")
        latest = _to_float(val_block.get("metric_value"))

        # 若没有直取数值，尝试吃“公式结果”
        if latest is None and isinstance(formula_block, dict) and ("result" in formula_block):
            latest = _to_float(formula_block.get("result"))

        # 尝试再从指标卡的 current 回退一次（DB 常见存成字符串）
        card = r.get("indicator_card") or {}
        if latest is None:
            latest = _to_float(card.get("current"))
        # 单位也可从指标卡兜底
        unit = unit or card.get("unit")

        # 计算 qoq / yoy（仅当 indicator_card 可用）
        qoq = yoy = None
        refs = (card.get("refs") or {})
        try:
            cur = _to_float(card.get("current"))
            ly  = _to_float(refs.get("last_year_value"))
            lp  = _to_float(refs.get("last_period_value"))
            if cur is not None and ly not in (None, 0):
                yoy = (cur - ly) / ly
            if cur is not None and lp not in (None, 0):
                qoq = (cur - lp) / lp
        except Exception:
            pass

        # 仍无 latest → 跳过，避免“空值污染”
        if latest is None:
            dbg("DQ_PARSE %s  latest=None  (value/indicator_card/formula都无值)", metric)
            continue

        # 追加时序（若有解析到 resolved.year/quarter）
        res = r.get("resolved") or {}
        try:
            yy = int(res.get("year")) if res.get("year") is not None else None
            qq = res.get("quarter")
            qq = int(str(qq).lstrip("Qq")) if qq is not None else None
        except Exception:
            yy = qq = None

        entry = agg.setdefault(metric, {"unit": unit})
        entry["latest"] = latest
        if qoq is not None: entry["qoq"] = qoq
        if yoy is not None: entry["yoy"] = yoy
        if unit and not entry.get("unit"): entry["unit"] = unit

        if yy and qq:
            ser = entry.setdefault("series", [])
            ser.append({"year": yy, "quarter": f"Q{qq}", "period": f"{yy}Q{qq}", "value": latest})


        dbg("DQ_PARSE %s  latest=%s unit=%s qoq=%s yoy=%s  src[value=%s card=%s formula=%s]",
            metric, latest, unit, qoq, yoy,
            (val_block.get('metric_value') is not None),
            ((r.get('indicator_card') or {}).get('current') is not None),
            (formula_block.get('result') is not None))
    return agg


def _to_float(x):
    """把 '12,345.6'、'123亿'、数字等尽量转为 float；失败返回 None"""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    # 去掉非数字/小数点/符号/科学计数的字符（避免“亿元”等单位残留）
    s = re.sub(r"[^\d\.\-\+eE]", "", s)
    if s in ("", ".", "-", "+"):
        return None
    try:
        return float(s)
    except Exception:
        return None


def _fmt_num(x):
    try:
        v = float(x)
    except Exception:
        return "-"
    ax = abs(v)
    if ax > 10000:
        return f"{int(round(v)):,}"
    elif ax < 1:
        return f"{v:.4f}"
    else:
        return f"{v:,.2f}"

def _fmt_pct(x):
    try:
        return f"{float(x)*100:.2f}%"
    except Exception:
        return "-"
def _db_metrics_to_markdown(dbm: dict) -> str:
    """
    把 {metric:{latest,qoq,yoy,unit}} 转成一个 Markdown 表格，供模型“照抄”
    """
    if not dbm:
        return ""
    lines = ["| 指标 | 最新值 | 环比 | 同比 | 单位 |", "|---|---:|---:|---:|---|"]
    for k, v in dbm.items():
        latest = _fmt_num(v.get("latest"))
        qoq    = _fmt_pct(v.get("qoq")) if v.get("qoq") is not None else "-"
        yoy    = _fmt_pct(v.get("yoy")) if v.get("yoy") is not None else "-"
        unit   = v.get("unit") or ""
        lines.append(f"| {k} | {latest} | {qoq} | {yoy} | {unit} |")
    return "\n".join(lines)
def _db_metrics_to_series_markdown(dbm: dict) -> str:
    """
    将 {metric:{series:[{year,quarter,value},...]}} 转成：
    | 指标 | 2024Q1 | 2024Q2 | 2024Q3 | ... |
    | 营业收入 | 60,134,000,000 | 65,934,000,000 | ... |
    | 归母净利润 | ... | ... | ... |
    """
    if not dbm:
        return ""
    # 收集并排序所有 period
    periods = []
    seen = set()
    def _qint(q):
        try: return int(str(q).lstrip("Qq"))
        except: return None
    for v in dbm.values():
        for pt in v.get("series", []) or []:
            y = int(pt.get("year")) if pt.get("year") is not None else None
            q = _qint(pt.get("quarter"))
            if y and q:
                k = (y, q)
                if k not in seen:
                    seen.add(k); periods.append(k)
    if not periods:
        return ""
    periods.sort(key=lambda x: (x[0], x[1]))
    period_labels = [f"{y}Q{q}" for (y, q) in periods]

    # 表头：指标 + 所有 period
    lines = ["| 指标 | " + " | ".join(period_labels) + " |"]
    lines.append("|---|" + "|".join(["---:" for _ in period_labels]) + "|")

    # 每个指标一行
    for metric, meta in dbm.items():
        row = [metric]
        series = meta.get("series", []) or []
        for (y, q) in periods:
            val = None
            for pt in series:
                yy = pt.get("year"); qq = _qint(pt.get("quarter"))
                if int(yy or 0) == y and qq == q:
                    val = pt.get("value"); break
            row.append(_fmt_num(val) if val is not None else "-")
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _collect_period_labels(dbm: dict) -> list[str]:
    """提取 db_metrics 中出现过的 period 标签，按时间排序"""
    labels = []
    seen = set()
    def _qint(q):
        try: return int(str(q).lstrip("Qq"))
        except: return None
    for v in dbm.values():
        for pt in v.get("series", []) or []:
            y = int(pt.get("year")) if pt.get("year") is not None else None
            q = _qint(pt.get("quarter"))
            if y and q:
                k = (y, q)
                if k not in seen:
                    seen.add(k); labels.append(k)
    labels.sort(key=lambda x: (x[0], x[1]))
    return [f"{y}Q{q}" for (y, q) in labels]

def _guess_ext(name: str) -> str:
    return os.path.splitext(name or "")[1].lower()

def _download_object(bucket: str, path: str) -> bytes:
    try:
        resp = sb.storage.from_(bucket).download(path)
        return resp if isinstance(resp, bytes) else (resp or b"")
    except Exception as e:
        logger.warning("download failed: %s/%s err=%s", bucket, path, e)
        return b""

def _extract_pdf(b: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(b))
        out = []
        for p in reader.pages:
            try:
                out.append(p.extract_text() or "")
            except Exception:
                pass
        return "\n".join(out)
    except Exception:
        return ""

def _extract_docx(b: bytes) -> str:
    try:
        buf = io.BytesIO(b)
        doc = Docx(buf)
        texts = [p.text for p in doc.paragraphs]
        return "\n".join(texts)
    except Exception:
        return ""

def _extract_csv(b: bytes) -> Tuple[str, str]:
    try:
        df = pd.read_csv(io.BytesIO(b))
        return df.to_csv(index=False)[:20000], df.head(20).to_markdown(index=False)
    except Exception:
        return "", ""

def _extract_xlsx(b: bytes) -> Tuple[str, str]:
    try:
        xl = pd.ExcelFile(io.BytesIO(b))
        summaries = []
        md_heads = []
        for sheet in xl.sheet_names[:4]:  # 最多前4个sheet
            df = xl.parse(sheet)
            summaries.append(f"--- 工作表: {sheet} ---\n{df.head(50).to_csv(index=False)}")
            md_heads.append(f"### {sheet}\n\n" + df.head(20).to_markdown(index=False) + "\n")
        return "\n\n".join(summaries)[:40000], "\n".join(md_heads)[:8000]
    except Exception:
        return "", ""

def _extract_html(b: bytes) -> str:
    try:
        s = b.decode("utf-8", errors="ignore")
    except Exception:
        s = ""
    # 很粗略地去标签
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return s

def _extract_txt(b: bytes) -> str:
    try:
        return b.decode("utf-8", errors="ignore")
    except Exception:
        return ""

def _summarize_table_csv_to_json(csv_text: str, max_rows: int = 60) -> List[Dict[str, Any]]:
    try:
        from io import StringIO
        df = pd.read_csv(StringIO(csv_text))
        if len(df) > max_rows:
            df = df.head(max_rows)
        return json.loads(df.to_json(orient="records"))
    except Exception:
        return []

def google_cse_search(query: str, count: int = 5) -> List[Dict[str, str]]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID): return []
    try:
        url = "https://www.googleapis.com/customsearch/v1"
        params = {"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": min(count,10)}
        r = requests.get(url, params=params, timeout=20)
        js = r.json()
        out = []
        for it in js.get("items", []):
            out.append({"title": it.get("title",""), "url": it.get("link",""), "summary": it.get("snippet","")})
        return out
    except Exception:
        return []

ECHARTS_RE = re.compile(r"```echarts\s*([\s\S]*?)```", re.M)
def normalize_echarts_blocks(md_text: str) -> str:
    def _sub(m):
        raw = (m.group(1) or "").strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                opt = obj
                opt.setdefault("legend", {}).setdefault("show", True)
                opt.setdefault("tooltip", {"trigger": "axis"})
                g = opt.setdefault("grid", {})
                g.setdefault("top", 48); g.setdefault("left", 56); g.setdefault("right", 32); g.setdefault("bottom", 48); g.setdefault("containLabel", True)
                if isinstance(opt.get("yAxis"), dict):
                    opt["yAxis"].setdefault("type", "value"); opt["yAxis"].setdefault("scale", True)
                elif not opt.get("yAxis"):
                    opt["yAxis"] = {"type": "value", "scale": True}
                return "```echarts\n" + json.dumps(opt, ensure_ascii=False) + "\n```"
        except Exception:
            pass
        return m.group(0)
    return ECHARTS_RE.sub(_sub, md_text)

SYSTEM_PROMPT = """
你是企业报告撰写智能体，支持两种工作模式：

【TemplateMode】当 template_text 非空：
- 先解析 template_text 的标题层级、编号样式、占位符（图表/表格/变量），生成章节树 JSON。
- 严格按模板章节与顺序写作；仅在模板给出图表/表格位时输出对应内容。
- 不擅自新增“宏观/风险”等模板中未出现的模块。
- 输出仅为 Markdown（可含 ```echarts {...}``` 与 Markdown 表格）。

【FreeMode】当 template_text 为空（例如用户只上传了“示例报告/样例PDF”等附件）：
- 不输出“模板不可解析”之类文案。
- 读取 user_query 与 attachments（尤其是 PDF/Word 示例报告的抽取文本），**学习其写作风格与结构**，包括：
  * 一级/二级标题的命名与编号风格（如 “一、二、三、…”、“第一章/第二章”、或 “1. 1.1 …”）
  * 常见章节名（如“执行摘要/经营概览/财务分析/宏观/风险等”），如示例报告包含则**参考命名**；没有就根据 user_query 合理规划 1–2 层大纲
  * 图表/表格的出现频率与类型（折线、柱状、对比表）；若示例报告常用图表，请至少输出 1–2 个 ```echarts``` 最小可运行 option
- 允许综合 attachments 与外部检索摘要，但不要逐字复刻。
- **若提供了 db_metrics（来自 Supabase financial_metrics），所有数值只能来自 db_metrics；严禁自造或估算。**
- 若 db_metrics 中存在多个 period 的 `series`，你必须：
  1) 在“数据要点”表后，**紧跟**输出一个名为“分期明细”的小节，并**直接粘贴** `series_markdown`（其表头为各期，如“2024Q1、2024Q2、…”；不得改动数字/期数；**禁止**使用任何代码块包裹，如 ```markdown）。
  2) 正文分析需**同时覆盖所有已出现的季度/年份**；可按时间顺序比较环比/同比，禁止仅围绕单一季度展开（除非仅有一个 period）。
  3) 至少输出一个按 period 组织的 ```echarts``` 图表（xAxis 为上述期数列表），series 对应 1~3 个关键指标。
  4) 若某些计划期无数据（见 `planned_periods` 与 `periods_covered` 差集），明确写“数据缺失”，不得臆造。

- 若 db_metrics 缺少某指标，只给文字描述“数据不足”，不要输出数值。
- 若提供了 `metrics_markdown`，请在正文开头生成一个名为“数据要点”的小节，并**原样输出该表格**（可按需要改表头措辞，但不得改动数据）。
- 正文分析与段落中的所有具体数字，均需与 `metrics_markdown` 保持一致。
- 若 db_metrics 为空，正文不得出现任何阿拉伯数字或百分号；仅输出结构化文字（标题、段落、列表）与图表占位，不要写数值。

- 语言与数字格式遵循 meta.locale（默认 zh-CN）与常规规范：表格首行为表头；≥10000 用千分位；0<|x|<1 保留四位小数，其余两位。
- 仅输出 Markdown 正文，不要免责声明、不加多余说明。

【图表与表格通用规则】
- 图表使用 ```echarts fenced code block，给出最小可运行 option（xAxis/yAxis/series/legend/tooltip 足够）。
- 表格用 Markdown，首行表头；尽量与正文口径一致。

【外部检索（可选）】
- 若 web_context 提供检索摘要，可据此丰富背景，但不要直接贴链接，请将信息融入正文。

【输出】
- 只输出 Markdown 正文。从文档标题开始，直到正文结束，不要输出本说明或“模板不可解析”等提示。
"""

def _llm_plan_from_query(prompt: str,
                         attachments: List[Dict[str,Any]],
                         meta: Dict[str,Any],
                         max_metrics: int = 10) -> Dict[str, Any]:
    """
    产出结构化计划：
    {
      "company": "公司规范名或空",
      "periods": [{"year":2025,"quarter":1}, ...],   # 已展开列表（含“全年/至今”等）
      "metrics": ["营业收入","归母净利润",...],        # 建议指标（结合附件&词表&“特别关注”）
      "need_clarification": false,
      "ask": ""
    }
    """
    # 供 LLM 选择的指标候选（canonical）
    alias_map = _load_metric_aliases()
    metric_pool = list(alias_map.keys())

    # 附件只作为“风格/重点提示”，不参与时间注入
    attach_hint = "\n".join([_safe_text(a.get("text"), 2000) for a in attachments])[:4000]

    sys = (
        "你是报告意图解析器。请把用户问题与附件摘要，转换为一个结构化“取数计划”。\n"
        "【目标】输出 JSON：公司、需要覆盖的年季列表(periods)、建议的指标列表(metrics)。\n"
        "【时间规则】\n"
        " - 支持：YYYY年、YYYY年Qn、YYYY全年、YYYY年至今、最近一季、上一季度、近N季等；必须落到明确的 {year,quarter} 列表。\n"
        " - “YYYY全年” → 展开为该年存在数据的 Q1~Q4；“YYYY年至今” → 从当年Q1 展开到当前最新可得季度；\n"
        " - 相对时间以新加坡时区今天为参照，若该季度在库中暂无数据，向最近一期回退。\n"
        "【公司规则】\n"
        " - 可从问题或附件推断；若不确定留空。\n"
        "【指标规则】\n"
        " - 仅可从给定 metric_pool 中选择 canonical 名称；\n"
        " - 若出现“特别关注/重点关注”等词，优先这些指标；不超过 max_metrics 条；\n"
        " - 若没有显式指标，给出通用经营+财务指标的合理组合（收入/净利/毛利率/净利率/ROE/资产负债率/经营现金流净额 等）。\n"
        "【输出】严格 JSON，形如：\n"
        "{\"company\":\"\",\"periods\":[{\"year\":2025,\"quarter\":1},{\"year\":2025,\"quarter\":2}],\"metrics\":[\"营业收入\",\"ROE\"],\"need_clarification\":false,\"ask\":\"\"}"
    )
    user = {
        "question": prompt,
        "attachments_hint": attach_hint,
        "metric_pool": metric_pool,
        "max_metrics": max_metrics
    }
    res = llm.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role":"system","content":sys},
                  {"role":"user","content":json.dumps(user, ensure_ascii=False)}],
        temperature=0
    )
    txt = (res.choices[0].message.content or "").strip()
    txt = re.sub(r"```json|```", "", txt).strip()
    try:
        plan = json.loads(txt)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", txt)
        plan = json.loads(m.group(0)) if m else {}

    # 兜底规范化
    periods = []
    for p in (plan.get("periods") or []):
        try:
            y = int(p.get("year"))
            q = _parse_year_quarter_from_text(f"{y}年Q{p.get('quarter')}")[1] or int(str(p.get("quarter")).lstrip("Qq"))
            if q in (1,2,3,4): periods.append({"year": y, "quarter": int(q)})
        except Exception:
            continue

    # 去重+排序
    seen=set(); out=[]
    for p in periods:
        k=(p["year"],p["quarter"])
        if k in seen: continue
        seen.add(k); out.append(p)
    out.sort(key=lambda x:(x["year"], x["quarter"]))

    metrics = plan.get("metrics") or []
    metrics = [m for m in metrics if m in metric_pool]
    if not metrics:
        # 回退：沿用我们已有的“特别关注+一般匹配+兜底”策略（仅对 prompt）
        focus = _extract_focus_metrics(prompt, limit=8)
        general = _extract_metrics_from_text(prompt, limit=12)
        merged=[]; s=set()
        for n in focus+general+DEFAULT_KPIS:
            if n and (n in metric_pool) and n not in s:
                s.add(n); merged.append(n)
        metrics = merged[:max_metrics]

    return {
        "company": plan.get("company") or (meta.get("company_name") if isinstance(meta, dict) else None),
        "periods": out,
        "metrics": metrics,
        "need_clarification": bool(plan.get("need_clarification")),
        "ask": plan.get("ask") or ""
    }


def build_messages(payload: NLGeneratePayload,
                   attachments: List[Dict[str, Any]],
                   web_snippets: List[Dict[str, str]],
                   template_text: str,
                   meta: Dict[str, Any],
                   db_metrics: dict | None = None,
                   series_markdown: str | None = None,
                   planned_periods: List[Dict[str,int]] | None = None,
                   periods_covered: List[str] | None = None) -> List[Dict[str, str]]:

    atts_brief = []
    for i, a in enumerate(attachments, 1):
        head = f"[附件{i}] {a.get('file_name')} ({a.get('mime_type','')}, {a.get('size_kb','')} KB)"
        text_part = _safe_text(a.get("text",""), 6000)
        tables_md = a.get("tables_md","")
        atts_brief.append(head + "\n" + (("【文本摘录】\n" + text_part) if text_part else "") + ("\n" + tables_md if tables_md else ""))

    web_brief = ""
    if web_snippets:
        lines = []
        for j, it in enumerate(web_snippets[:6], 1):
            lines.append(f"[{j}] {it.get('title','')} - {it.get('url','')}\n{it.get('summary','')}")
        web_brief = "【外部检索摘要】\n" + "\n".join(lines)

    user_payload = {
        "instruction": payload.prompt,
        "language": payload.language or "zh",
        "meta": meta or {},
        "template_text": f"<<<TEMPLATE\n{template_text or ''}\nTEMPLATE\n>>>",
        "attachments": "\n\n".join(atts_brief),
        "web_context": web_brief
    }
    if db_metrics:
        user_payload["db_metrics"] = db_metrics
        user_payload["metrics_markdown"] = _db_metrics_to_markdown(db_metrics)
        if series_markdown:
            user_payload["series_markdown"] = series_markdown
        if planned_periods is not None:
            user_payload["planned_periods"] = planned_periods  # 形如 [{"year":2025,"quarter":1},...]
        if periods_covered is not None:
            user_payload["periods_covered"] = periods_covered  # 形如 ["2024Q4","2025Q1","2025Q2"]


    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}
    ]



def _read_attachments(file_ids: List[str]) -> List[Dict[str, Any]]:
    if not file_ids: return []
    try:
        res = sb.table("report_uploads").select("*").in_("id", file_ids).limit(100).execute()
        rows = getattr(res,"data",[]) or []
    except Exception as e:
        raise HTTPException(400, f"读取上传清单失败: {e}")

    out = []
    for r in rows:
        bucket = r.get("bucket") or "uploads"
        path   = r.get("path") or ""
        name   = r.get("file_name") or path.split("/")[-1]
        mime   = (r.get("mime_type") or "").lower()
        b = _download_object(bucket, path)
        text, tables_md = "", ""

        ext = _guess_ext(name)
        if "pdf" in mime or ext == ".pdf":
            text = _extract_pdf(b)
        elif "word" in mime or ext == ".docx":
            text = _extract_docx(b)
        elif "excel" in mime or ext in (".xlsx",".xls"):
            csv_text, md_head = _extract_xlsx(b)
            text = csv_text
            tables_md = md_head
        elif "csv" in mime or ext == ".csv":
            csv_text, md_head = _extract_csv(b)
            text = csv_text
            tables_md = md_head
        elif "html" in mime or ext == ".html":
            text = _extract_html(b)
        else:
            text = _extract_txt(b)

        out.append({
            "file_name": name,
            "mime_type": mime or ext,
            "size_kb": round(len(b)/1024),
            "text": text,
            "tables_md": tables_md
        })
    return out
def _read_single_upload_text(file_id: str) -> Tuple[str, str, str]:
    """
    返回: (text, tables_md, file_name)
    """
    if not file_id:
        return "", "", ""
    try:
        res = sb.table("report_uploads").select("*").eq("id", file_id).limit(1).execute()
        rows = getattr(res, "data", []) or []
        if not rows:
            return "", "", ""
        r = rows[0]
        bucket = r.get("bucket") or "uploads"
        path   = r.get("path") or ""
        name   = r.get("file_name") or path.split("/")[-1]
        mime   = (r.get("mime_type") or "").lower()
        b = _download_object(bucket, path)

        text, tables_md = "", ""
        ext = _guess_ext(name)
        if "pdf" in mime or ext == ".pdf":
            text = _extract_pdf(b)
        elif "word" in mime or ext == ".docx":
            text = _extract_docx(b)
        elif "excel" in mime or ext in (".xlsx", ".xls"):
            csv_text, md_head = _extract_xlsx(b); text = csv_text; tables_md = md_head
        elif "csv" in mime or ext == ".csv":
            csv_text, md_head = _extract_csv(b); text = csv_text; tables_md = md_head
        elif "html" in mime or ext == ".html":
            text = _extract_html(b)
        else:
            text = _extract_txt(b)
        return text, tables_md, name
    except Exception:
        return "", "", ""

@app.get("/health")
def health():
    return {"ok": True, "time": dt.datetime.utcnow().isoformat()}

@app.post("/freereport/generate")
def freereport_generate(payload: NLGeneratePayload, _=Depends(auth_check)):
    try:
        # 1) 附件
        attachments = _read_attachments(payload.selected_file_ids or [])

        # 2) 可选外部检索
        web_snippets = []
        if payload.allow_web_search and (GOOGLE_API_KEY and GOOGLE_CSE_ID):
            q = re.sub(r"\s+"," ", payload.prompt)[:100]
            web_snippets = google_cse_search(q, count=5)

        # 3) 组装消息并调用 LLM
        # 2.5) 解析模板：优先用 payload.template_text；否则按 template_file_id 读取
        template_text = (payload.template_text or "").strip()
        if (not template_text) and payload.template_file_id:
            t_text, _, _ = _read_single_upload_text(payload.template_file_id)
            template_text = t_text or ""

        # meta 透传（可空）
        # 解析 meta（company + 起止年季）；拉财务指标
        meta = payload.meta or {}
        company, start, end = _parse_meta_period(meta)

        db_metrics = {}
        if company and start and end:
            try:
                df = fetch_financial_metrics_all(company, start, end)
                db_metrics = summarize_timeseries(df)
                logger.info("metrics rows=%s, metrics_found=%s", 
                            (0 if df is None else df.shape[0]), len(db_metrics))
            except Exception as e:
                logger.warning("fetch metrics failed: %s", e)
                db_metrics = {}

        # —— NEW：先用 LLM 生成“结构化计划”（公司 / 年季列表 / 指标列表）
        plan = _llm_plan_from_query(payload.prompt or "", attachments, meta, max_metrics=12)
        print(f"[freereports] plan_company={plan.get('company')} "
            f"periods={[(p['year'],p['quarter']) for p in plan.get('periods',[])]} "
            f"metrics={plan.get('metrics')}", flush=True)

        # 若 periods 为空（如“行业现状”这种），允许回退到 meta.period.end 的单期；仍然不读附件里的旧期
        periods = plan.get("periods") or []
        if (not periods) and meta:
            _, _, end = _parse_meta_period(meta)
            if end:
                periods = [{"year": int(end[0]), "quarter": int(end[1][-1])}]

        # 组装任务（period × metric）—— 显式给 company/year/quarter；同时携带原问题作为上下文提示
        tasks = []
        for p in periods or []:
            for m in (plan.get("metrics") or []):
                tasks.append({
                    "metric": m,
                    "company": plan.get("company"),
                    "year": p["year"],
                    "quarter": p["quarter"],
                    "question": payload.prompt or ""
                })

        # 如果还是空（极端情况），至少给每个指标一条“让 dataquery 自解”的任务
        if not tasks:
            for m in (plan.get("metrics") or []):
                tasks.append({"metric": m, "question": payload.prompt or ""})

        print("[freereports] tasks=", json.dumps(tasks, ensure_ascii=False)[:400], flush=True)




        dbg("TASKS %d → %s", len(tasks), ", ".join([f"{t.get('metric')}@{t.get('company')}:{t.get('year')}Q{t.get('quarter')}" for t in tasks]))
        print("[freereports] tasks=", json.dumps(tasks, ensure_ascii=False)[:400], flush=True)  # <== 新增
        dq_results = _dq_call_batch(tasks, max_workers=8)
        dq_db_metrics = _build_db_metrics_from_dq(dq_results)

        print(f"[freereports] dq_results_count={len([r for r in dq_results if r])} "
      f"dq_hits={list((dq_db_metrics or {}).keys())[:8]}", flush=True)  # <== 新增

        # 合并：dataquery 优先；没有再用直接查表的汇总
        merged_db_metrics = dict(db_metrics or {})
        merged_db_metrics.update(dq_db_metrics or {})

        # 命中统计 + 可读的“数据要点表”
        try:
            ok_cnt = sum(1 for r in (dq_results or []) if r and (r.get("value") or r.get("formula") or (r.get("indicator_card") or {}).get("current") is not None))
            keys = ", ".join(list((dq_db_metrics or {}).keys())[:20])
            logger.info("dataquery url=%s tasks=%d ok=%d keys=[%s]", DATAQUERY_BASE_URL, len(tasks), ok_cnt, keys)
        except Exception:
            pass

        metrics_table_md = _db_metrics_to_markdown(merged_db_metrics)
        series_md = _db_metrics_to_series_markdown(merged_db_metrics)
        periods_covered = _collect_period_labels(merged_db_metrics)

        # planned_periods 就是我们前面 plan/展开得到的 periods（可能为空）
        planned = periods or []

        print("DBG METRICS_TABLE_BEGIN", flush=True)             # <== 新增
        print(metrics_table_md or "(empty)", flush=True)         # <== 新增
        if DEBUG and metrics_table_md:
            dbg("METRICS_TABLE\n%s", metrics_table_md)
        print("DBG METRICS_TABLE_END", flush=True)    


        # 组装消息并调用 LLM（把 merged_db_metrics 传进去）
        # 只用合并后的指标（含 dataquery 返回）
        messages = build_messages(
            payload, attachments, web_snippets, template_text, meta,
            db_metrics=merged_db_metrics,
            series_markdown=series_md,
            planned_periods=planned,
            periods_covered=periods_covered
                )   

        resp = llm.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.2
        )

        content = resp.choices[0].message.content or ""
        content = normalize_echarts_blocks(content)

        return {
            "job_id": str(uuid.uuid4()),
            "generated_at": dt.datetime.utcnow().isoformat(),
            "content_md": content,
            "attachments_used": [a["file_name"] for a in attachments],
            "web_refs": web_snippets,
            "debug": {
                "dq_tasks": tasks,
                "dq_hits": list((dq_db_metrics or {}).keys()),
                "metrics_table": metrics_table_md[:4000]  # 防止过长
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("freereport failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(500, f"freereport_failed: {e}")
