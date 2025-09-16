# -*- coding: utf-8 -*-
from __future__ import annotations
import os, json, re, math
from typing import Any, Dict, Optional, List, Tuple

import requests
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
# --- CORS hardening ---
from fastapi import Request
from starlette.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from starlette.responses import JSONResponse, Response

from dotenv import load_dotenv, find_dotenv
import time
p = find_dotenv(".env.backend", raise_error_if_not_found=False)
load_dotenv(p, override=True)

LLM_BASE  = (os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or os.getenv("LLM_BASE_URL") or "").rstrip("/")
LLM_KEY   = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or ""
LLM_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or ""
LLM_CONNECT_TIMEOUT = int(os.getenv("LLM_CONNECT_TIMEOUT") or 30)
LLM_READ_TIMEOUT    = int(os.getenv("LLM_READ_TIMEOUT") or 90)
print("[dataquery LLM]", LLM_BASE, LLM_MODEL)

# --- timezone & LLM config ---
try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEV_BYPASS_AUTH = os.getenv("DEV_BYPASS_AUTH") == "true"
# --- CORS (唯一定义，放在 app 创建之后) ---
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}

app = FastAPI(title="DataQuery Agent", version="0.6.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

@app.options("/{path:path}")
async def options_handler(request: Request, path: str):
    origin = request.headers.get("origin")
    resp = Response(status_code=204)
    if origin in ALLOWED_ORIGINS:
        resp.headers.update({
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": request.headers.get("Access-Control-Request-Method", "*"),
            "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers", "*"),
        })
    return resp

@app.middleware("http")
async def add_cors_on_error(request: Request, call_next):
    origin = request.headers.get("origin")
    try:
        resp = await call_next(request)
    except Exception as e:
        resp = JSONResponse({"detail": str(e)}, status_code=500)
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp

# ---------------- Common ---------------- #

async def require_token(authorization: str = Header(None)):
    if DEV_BYPASS_AUTH:
        return
    return

def _sb(path: str, params: Dict[str,Any]) -> Any:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise HTTPException(500, "Supabase credentials not configured")
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path.lstrip('/')}"
    r = requests.get(
        url, params=params, timeout=20,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    return r.json()

def _sb_safe(path: str, params: Dict[str,Any]) -> Any:
    try:
        return _sb(path, params)
    except Exception as e:
        print("[supabase warn]", e)
        return []

# --- metric matching helpers ---
GROWTH_KWS = ["增长率", "同比", "环比", "增速"]  # 只用这些强语义词，不把“率”算进去

def _to_alias_list(als) -> List[str]:
    """把 aliases 列统一转成 list[str]，兼容 JSON 字符串 / Postgres 数组文本 / 逗号分隔"""
    if als is None:
        return []
    if isinstance(als, list):
        return [str(x).strip() for x in als if x is not None and str(x).strip()]
    if isinstance(als, str):
        s = als.strip()
        # JSON / Postgres 数组文本
        try:
            if (s.startswith("[") and s.endswith("]")) or (s.startswith("{") and s.endswith("}")):
                j = json.loads(s.replace("{", "[").replace("}", "]"))
                if isinstance(j, list):
                    return [str(x).strip() for x in j if x is not None and str(x).strip()]
        except Exception:
            pass
        # 回退：常见分隔符
        s2 = s.strip("{}")
        parts = re.split(r'[,\|/;；，、\s]+', s2)
        return [p.strip().strip('"').strip("'") for p in parts if p.strip()]
    return []

def _gen_variants(name: str) -> List[str]:
    """为中文公司名生成宽松变体：去掉/替换“集团公司/公司”等"""
    if not name:
        return []
    cand = {name}
    cand.add(name.replace("集团公司", "集团"))
    if name.endswith("公司"):
        cand.add(name[:-2])
    return [x for x in cand if x]

def _norm(s: str) -> str:
    """统一大小写并去空白"""
    return re.sub(r"\s+", "", (s or "")).lower()

def _has_any(s: str, kws: list[str]) -> bool:
    ss = s or ""
    return any(k in ss for k in kws)

# --- helpers for relative time inference ---
def _latest_period(company: Optional[str] = None, metric: Optional[str] = None):
    params = {"select": "year,quarter", "order": "year.desc,quarter.desc", "limit": "1"}
    if company: params["company_name"] = f"eq.{company}"
    if metric:  params["metric_name"]  = f"eq.{metric}"
    rows = _sb_safe("financial_metrics", params)
    return (int(rows[0]["year"]), int(rows[0]["quarter"])) if rows else None

def _latest_in_year(year: int, company: Optional[str] = None, metric: Optional[str] = None):
    params = {"select": "quarter", "year": f"eq.{int(year)}", "order": "quarter.desc", "limit": "1"}
    if company: params["company_name"] = f"eq.{company}"
    if metric:  params["metric_name"]  = f"eq.{metric}"
    rows = _sb_safe("financial_metrics", params)
    return int(rows[0]["quarter"]) if rows else None

def _exists_period(year: int, quarter: int, company: Optional[str]=None, metric: Optional[str]=None) -> bool:
    params = {"select": "year", "year": f"eq.{int(year)}", "quarter": f"eq.{int(quarter)}", "limit": "1"}
    if company: params["company_name"] = f"eq.{company}"
    if metric:  params["metric_name"]  = f"eq.{metric}"
    rows = _sb_safe("financial_metrics", params)
    return bool(rows)

def _prev_quarter(y: int, q: int):
    return (y-1, 4) if q == 1 else (y, q-1)

_REL_WORDS = ("最近","近期","上季度","上一季","上季","本季度","本季","今年","去年同期","去年同季","年初")
def _has_relative(text: Optional[str]) -> bool:
    if not text: return False
    if any(w in text for w in _REL_WORDS): return True
    return bool(re.search(r"近\s*\d+\s*季", text))

def _infer_time_from_db(question: str, company: Optional[str], metric: Optional[str]):
    """把相对时间词落到具体年/季。优先 company+metric → company → 全表。"""
    latest = _latest_period(company, metric) or _latest_period(company) or _latest_period()
    if not latest: 
        return (None, None)
    y0, q0 = latest

    t = question
    if any(k in t for k in ("最近","近期")):
        return (y0, q0)
    if any(k in t for k in ("上季度","上一季","上季")):
        return _prev_quarter(y0, q0)
    if "今年" in t:
        from datetime import datetime
        y = datetime.now().year
        q = _latest_in_year(y, company, metric)
        return (y, q) if q else (y0, q0)
    if any(k in t for k in ("本季度","本季")):
        from datetime import datetime
        now = datetime.now()
        q = (now.month - 1)//3 + 1
        return (now.year, q) if _exists_period(now.year, q, company, metric) else (y0, q0)
    if any(k in t for k in ("去年同期","去年同季")):
        y1, q1 = (y0-1, q0)
        return (y1, q1) if _exists_period(y1, q1, company, metric) else (y0, q0)
    if "年初" in t:
        q = _latest_in_year(y0, company, metric)
        return (y0, 1 if _exists_period(y0, 1, company, metric) else (q or q0))
    if re.search(r"近\s*\d+\s*季", t):
        # 当前接口是“单点期”查询，默认落到最近一期
        return (y0, q0)
    return (None, None)

def _now_sgt():
    try:
        return datetime.now(ZoneInfo("Asia/Singapore")) if ZoneInfo else datetime.now()
    except Exception:
        return datetime.now()

# ---------------- Catalog caches ---------------- #
# metric_alias_catalog: canonical_name + aliases + unit + is_derived + compute_key
_ALIAS_CACHE: Dict[str,Dict[str,Any]] = {}

def load_metric_alias_cache(force: bool=False):
    global _ALIAS_CACHE
    if _ALIAS_CACHE and not force:
        return
    rows = _sb_safe("metric_alias_catalog", {
        "select": "canonical_name,aliases,unit,is_derived,compute_key"
    })
    cache = {}
    for r in rows:
        als = _to_alias_list(r.get("aliases"))
        cache[str(r["canonical_name"])] = {
            "aliases": als,
            "unit": r.get("unit"),
            "is_derived": bool(r.get("is_derived")),
            "compute_key": r.get("compute_key") or r["canonical_name"],
        }
    _ALIAS_CACHE = cache

def match_metric_canonical(text: str) -> Optional[str]:
    """
    规则：
    1) 先按别名/规范名在问题里出现的“长度”打分（越长越好）
    2) 若候选是“增长类”(包含 增长率/同比/环比/增速)，但问题里没有这些词 → 直接重罚，优先选基准值类
    3) 若问题里出现增长类词，但候选不是增长类 → 轻微扣分
    """
    load_metric_alias_cache()
    q = text or ""
    qn = _norm(q)
    if not qn:
        return None

    q_has_growth = _has_any(q, GROWTH_KWS)

    best_name, best_score = None, -1e9
    for canonical, meta in _ALIAS_CACHE.items():
        names = [canonical] + meta["aliases"]
        cand_has_growth = _has_any(canonical, GROWTH_KWS) or any(_has_any(a, GROWTH_KWS) for a in names)

        base = -1e6
        for n in names:
            ns = _norm(n)
            if not ns:
                continue
            if ns in qn or qn in ns:   # 双向包含
                base = max(base, len(ns) * 10)
                try:
                    if re.search(rf'(?<![\w\u4e00-\u9fff]){re.escape(n)}(?![\w\u4e00-\u9fff])', q):
                        base = max(base, len(ns) * 12)
                except Exception:
                    pass

        if base < 0:
            continue

        penalty = 0
        if cand_has_growth and not q_has_growth:
            penalty -= 1000
        elif q_has_growth and not cand_has_growth:
            penalty -= 20

        score = base + penalty
        if score > best_score:
            best_name, best_score = canonical, score

    return best_name

def metric_meta(canonical: str) -> Optional[Dict[str,Any]]:
    load_metric_alias_cache()
    return _ALIAS_CACHE.get(canonical)

# company_catalog: company_name + aliases
_COMPANY_CACHE: Dict[str,Dict[str,Any]] = {}

def load_company_catalog_cache(force: bool=False):
    """Load company canonical + aliases. Try company_catalog"""
    global _COMPANY_CACHE
    if _COMPANY_CACHE and not force:
        return
    rows = _sb_safe("company_catalog", {"select": "display_name,aliases"})
    if not rows:
        rows = _sb_safe("company_catalog", {"select": "display_name,aliases"})
    cache: Dict[str,Dict[str,Any]] = {}
    for r in rows:
        canonical = (r.get("display_name"))
        if not canonical:
            continue
        als = _to_alias_list(r.get("aliases"))
        disp = r.get("display_name")
        for v in _gen_variants(canonical) + _gen_variants(disp or ""):
            if v and v != canonical:
                als.append(v)
        seen = set(); als = [a for a in als if not (a in seen or seen.add(a))]
        cache[str(canonical)] = {"aliases": als}
    _COMPANY_CACHE = cache

def match_company_name(text: str) -> Optional[str]:
    load_company_catalog_cache()
    t = _norm(text)
    if not t:
        return None
    best = None
    best_len = 0
    for canonical, meta in _COMPANY_CACHE.items():
        names = [canonical] + meta.get("aliases", [])
        expanded = set()
        for n in names:
            expanded.update([n, *_gen_variants(n)])
        for n in expanded:
            ns = _norm(n)
            if not ns:
                continue
            if ns in t or t in ns:
                if len(ns) > best_len:
                    best, best_len = canonical, len(ns)
    return best

# ---------------- Lightweight parser (兜底) ---------------- #
YEAR_RE = re.compile(r"(20\d{2})")
QUARTER_RE = re.compile(r"(?:^|[^A-Za-z])Q([1-4])|第([一二三四1234])季", re.I)

def parse_question(question: str) -> Dict[str,Any]:
    out: Dict[str,Any] = {}
    if not question:
        return out
    m = YEAR_RE.search(question)
    if m:
        out["year"] = int(m.group(1))
    m = QUARTER_RE.search(question)
    if m:
        q = m.group(1) or m.group(2)
        m2 = {"一":"1","二":"2","三":"3","四":"4"}
        q = int(m2.get(q, q))
        out["quarter"] = q
    m = re.search(r'([\u4e00-\u9fa5A-Za-z0-9]+?(?:集团公司|港口公司|金融公司|地产公司|公司|集团))', question)
    if m:
        out["company"] = m.group(1)
    cn = match_metric_canonical(question)
    if cn:
        out["metric"] = cn
    return out

# ---------------- financial_metrics fetch ---------------- #
def fetch_metric_value(company_name: str, year: int, quarter: int, metric_name: str) -> Optional[float]:
    params = {
        "select": "metric_value",
        "company_name": f"eq.{company_name}",
        "year": f"eq.{int(year)}",
        "quarter": f"eq.{int(quarter)}",
        "metric_name": f"eq.{metric_name}",
        "limit": "1",
    }
    rows = _sb_safe("financial_metrics", params)
    if rows:
        try:
            return float(rows[0]["metric_value"])
        except Exception:
            return None
    return None

# 新增：一次把同列的比较值取出来
def fetch_metric_row(company_name: str, year: int, quarter: int, metric_name: str) -> Optional[Dict[str,Any]]:
    params = {
        "select": "metric_value,baseline_target,last_year_value,last_period_value,source",
        "company_name": f"eq.{company_name}",
        "year": f"eq.{int(year)}",
        "quarter": f"eq.{int(quarter)}",
        "metric_name": f"eq.{metric_name}",
        "limit": "1",
    }
    rows = _sb_safe("financial_metrics", params)
    return rows[0] if rows else None

# ---------------- Formula utils ---------------- #
SAFE_FUNCS = {"abs": abs, "min": min, "max": max, "round": round, "sqrt": math.sqrt}

def safe_eval(expr: str, env: Dict[str, float]) -> float:
    return float(eval(expr, {"__builtins__": {}, **SAFE_FUNCS}, env))

def fmt_num(v: float) -> str:
    try:
        x = float(v)
    except Exception:
        return str(v)
    ax = abs(x)
    if ax > 10000:
        return f"{int(round(x)):,}"
    elif ax < 1:
        return f"{x:.4f}"
    else:
        return f"{x:,.2f}"

def load_formula(metric_name_cn: str) -> Optional[Dict[str,Any]]:
    rows = _sb_safe("metric_formulas", {
        "select": "metric_name,description,variables,compute,enabled,is_standard,id",
        "metric_name": f"eq.{metric_name_cn}",
        "enabled": "eq.true",
        "order": "is_standard.desc,id.desc",
        "limit": "1",
    })
    return rows[0] if rows else None

def compute_by_formula(metric_cn: str,
                       variables: Dict[str, str],
                       compute_graph: Dict[str, str],
                       fetcher,
                       env_hint: Dict[str,Any]) -> Tuple[float, Dict[str,float], Dict[str,float], str]:
    base_vals: Dict[str, float] = {}
    missing: List[str] = []
    for var_key, base_cn in variables.items():
        v = fetcher(base_cn)
        if v is None:
            missing.append(base_cn)
        else:
            base_vals[var_key] = v
    if missing:
        raise HTTPException(404, f"基础指标缺失：{', '.join(missing)}，请补充 {env_hint}")
    values = dict(base_vals)
    pending = dict(compute_graph)
    order = list(pending.keys())
    for _ in range(len(pending) + 2):
        done = []
        for k, expr in pending.items():
            try:
                values[k] = safe_eval(expr, values)
                done.append(k)
            except Exception:
                pass
        for k in done:
            pending.pop(k)
        if not pending:
            break
    if pending:
        raise HTTPException(400, f"公式未能解析：{list(pending.keys())}")
    result_var = order[-1] if order else None
    if not result_var:
        raise HTTPException(400, "公式未提供结果变量")
    result = float(values[result_var])
    return result, values, base_vals, result_var

def make_expression(metric_cn: str, result_var: str,
                    values: Dict[str, float],
                    variables: Dict[str, str],
                    compute: Dict[str, str]):
    rhs = compute[result_var]
    def replace_vars_with_cn(expr: str) -> str:
        out = expr
        for k in sorted(variables.keys(), key=len, reverse=True):
            out = re.sub(rf"\b{k}\b", variables[k])
        out = re.sub(rf"\b{result_var}\b", metric_cn, out)
        return out
    expr_cn_rhs = replace_vars_with_cn(rhs)
    expr = f"{metric_cn} = {expr_cn_rhs}"
    cn2val: Dict[str, float] = {}
    for k, cn in variables.items():
        if k == result_var:
            continue
        if k in values and values[k] is not None:
            cn2val[cn] = float(values[k])
    sub = expr_cn_rhs
    for cn in sorted(cn2val.keys(), key=len, reverse=True):
        sub = sub.replace(cn, fmt_num(cn2val[cn]))
    table = [{"指标/变量": cn, "值": fmt_num(val)} for cn, val in cn2val.items()]
    return expr, sub, table

def compute_or_fetch_metric(company: str, year: int, quarter: int, metric_cn: str, depth: int = 0) -> Optional[float]:
    if depth > 3:
        return None
    # 1) 直取
    v = fetch_metric_value(company, year, quarter, metric_cn)
    if v is not None:
        return v
    # 2) 公式
    f = load_formula(metric_cn)
    if not f:
        return None
    variables = f.get("variables") or {}
    compute = f.get("compute") or {}
    if isinstance(variables, str):
        try: variables = json.loads(variables)
        except Exception: variables = {}
    if isinstance(compute, str):
        try: compute = json.loads(compute)
        except Exception: compute = {}
    try:
        result, *_ = compute_by_formula(
            metric_cn, variables, compute,
            lambda base_cn: compute_or_fetch_metric(company, year, quarter, base_cn, depth+1),
            env_hint={"company_name": company, "year": year, "quarter": f"Q{quarter}"}
        )
        return result
    except Exception:
        return None

# ---------------- LLM-first structured parsing ---------------- #
def _parse_quarter_to_int(q: Any) -> Optional[int]:
    if q is None: return None
    s = str(q).strip().upper()
    if s.startswith("Q"): s = s[1:]
    try:
        i = int(s)
        if i in (1,2,3,4):
            return i
    except Exception:
        pass
    return None

def _catalog_payload_for_llm():
    load_company_catalog_cache()
    load_metric_alias_cache()
    companies = [{"display_name": c, "aliases": _COMPANY_CACHE[c]["aliases"]} for c in _COMPANY_CACHE]
    metrics   = [{"canonical_name": m, "aliases": _ALIAS_CACHE[m]["aliases"]} for m in _ALIAS_CACHE]
    return companies, metrics

def llm_structured_parse(question: str) -> Dict[str, Any]:
    start_ts = time.time()
    """
    调用 LLM：让其在给定 company/metric 选项内，产出 {company, metric, year, quarter}。
    失败时返回 {"need_clarification": True, "ask": "..."}。

    兼容：
    - gpt-5 / o4 / o3 → /responses + input（不发送 temperature）
    - 其它模型（如 gpt-4o-mini）→ /chat/completions + messages（temperature=0）
    """
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        return {"need_clarification": True, "ask": "未配置大模型参数。请提供公司、指标、年份与季度。"}

    companies, metrics = _catalog_payload_for_llm()
    now = _now_sgt().strftime("%Y-%m-%d")
    hint_any = _latest_period()

    # —— 仍然保留你的提示词（原封不动） —— #
    sys_prompt = (
        "你是财务语义解析器。你的任务是从用户问题中**抽取并规范化** 公司、指标、时间，并在不确定时给出单句最小追问。\n"
        "【输入】\n"
        "- now: 当前日期(YYYY-MM-DD)\n"
        "- companies: [{companies[].display_name, companies[].aliases}] 只允许从这里选公司\n"
        "- metrics: [{canonical_name, aliases:[]}] 只允许从这里选指标\n"
        "- hint_latest_any: 可能只包含 overall={year,quarter}（可为空）\n"
        "- question: 用户原始问题\n"
        "【解析规则】\n"
        "1) company：从 question 中定位疑似公司片段；只能映射到 companies[].display_name（命中companies[].aliases需转成对应 name）。\n"
        "2) metric：从 question 中定位指标片段；只能映射到 metrics[].canonical_name（命中metrics[].aliases需转成 canonical_name）。\n"
        "   规则：除非问题里有【增长率/同比/环比/增速】等字样，否则**禁止**选择带这些字样的指标。\n"
        "3) 时间：输出 {year:int, quarter:1-4}。相对时间必须落到具体年季，优先级：公司+指标→公司→overall→按 now 推算并回退。\n"
        "4) 任一项无法唯一确定：need_clarification=true，ask 用中文单句最小追问。\n"
        "【输出】严格 JSON：{\"company\":\"公司规范名\",\"metric\":\"指标规范名\",\"year\":int,\"quarter\":1|2|3|4,\"need_clarification\":bool,\"ask\":\"...或空串\"}\n"
    )
    user_prompt = {
        "now": now,
        "hint_latest_any": hint_any,
        "companies": companies,
        "metrics": metrics,
        "question": question,
        "output_format": {"company": "公司规范名", "metric": "指标规范名", "year": "int", "quarter": "1~4"},
    }

    
    # —— 根据模型名选择端点与 payload —— #
    is_responses = str(LLM_MODEL).lower().startswith(("gpt-5", "o4", "o3"))
    url = f"{LLM_BASE.rstrip('/')}/responses" if is_responses else f"{LLM_BASE.rstrip('/')}/chat/completions"

    if is_responses:
        # ✅ Responses API：使用 content-blocks，并给出 max_output_tokens
        payload = {
            "model": LLM_MODEL,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": sys_prompt}]},
                {"role": "user",   "content": [{"type": "input_text", "text": json.dumps(user_prompt, ensure_ascii=False)}]},
            ],
            "max_output_tokens": 1024
        }
    else:
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user",   "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            "temperature": 0,
        }



    connect_to = globals().get("LLM_CONNECT_TIMEOUT", 30)
    read_to    = globals().get("LLM_READ_TIMEOUT", 120)

    try:
        r = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {LLM_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=(connect_to, read_to)
        )

        elapsed_ms = int((time.time() - start_ts) * 1000)
        endpoint = "responses" if is_responses else "chat/completions"


        if not r.ok:
            reg = parse_question(question)
            return {
                "company": reg.get("company"),
                "metric": reg.get("metric"),
                "year": reg.get("year"),
                "quarter": reg.get("quarter"),
                "need_clarification": True,
                "ask": "请补充公司、指标或时间（年/季）。",
                "_debug": {"ok": False, "status": r.status_code, "endpoint": endpoint,
                        "elapsed_ms": elapsed_ms, "model": LLM_MODEL}
            }

        data = r.json()

        # —— 统一抽取文本 —— #
        text = None
        if isinstance(data, dict) and "output_text" in data:  # responses 直出
            text = data.get("output_text")
        if text is None and isinstance(data, dict) and data.get("choices"):
            ch0 = data["choices"][0]
            text = (ch0.get("message") or {}).get("content") or ch0.get("text")
        if text is None and isinstance(data, dict) and data.get("output"):
            try:
                parts = data["output"][0].get("content", [])
                texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("text")]
                text = "\n".join(texts) if texts else None
            except Exception:
                pass
        if (not text) and is_responses:
            # ⚠️ 某些网关在 /responses 不回 output_text，这里回退一次到 /chat/completions
            try:
                url2 = f"{LLM_BASE.rstrip('/')}/chat/completions"
                payload2 = {
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user",   "content": json.dumps(user_prompt, ensure_ascii=False)},
                    ],
                    "temperature": 0,
                }
                r2 = requests.post(
                    url2,
                    headers={"Authorization": f"Bearer {LLM_KEY}","Content-Type":"application/json"},
                    json=payload2, timeout=(connect_to, read_to)
                )
                if r2.ok:
                    d2 = r2.json()
                    ch0 = (d2.get("choices") or [{}])[0]
                    text = (ch0.get("message") or {}).get("content") or ch0.get("text")
                    endpoint = "chat/completions"
                    r = r2  # 下面 _debug 用到 status
            except Exception:
                pass

        if not text:
            raise ValueError("empty LLM text")

        # —— 你的原始 JSON 清洗逻辑（保留） —— #
        content = re.sub(r"```json|```", "", text).strip()
        # 尝试直接 loads；失败再做一个简单提取
        try:
            data_obj = json.loads(content)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", content)
            if not m:
                raise
            data_obj = json.loads(m.group(0))

    except Exception as e:
    
        print("[llm parse warn]", e)
        reg = parse_question(question)
    # [ADD] 把失败也当作一次 LLM 调用写进 _debug，便于前端显示原因
        return {
        "company": reg.get("company"),
        "metric": reg.get("metric"),
        "year": reg.get("year"),
        "quarter": reg.get("quarter"),
        "need_clarification": True,
        "ask": "请补充公司、指标或时间（年/季）。",
        "_debug": {
            "ok": False,
            "endpoint": "responses" if is_responses else "chat/completions",
            "model": LLM_MODEL
        }
    }


    if data_obj.get("need_clarification"):
        return {"need_clarification": True, "ask": data_obj.get("ask") or "请补充公司、指标或时间（年/季）。"}

    comp = data_obj.get("company")
    metr = data_obj.get("metric")
    year = data_obj.get("year")
    q    = _parse_quarter_to_int(data_obj.get("quarter"))

    data_obj["_debug"] = {"ok": True, "status": r.status_code, "endpoint": endpoint,
                        "elapsed_ms": elapsed_ms, "model": LLM_MODEL}
    # 统一 quarter 为 1~4 的整数，避免后续解析异常
    if q is not None:
        data_obj["quarter"] = q
    return data_obj

    #return {"company": comp, "metric": metr, "year": year, "quarter": q}


# ---------------- Indicator Card helper ---------------- #
def build_indicator_card(row: Dict[str,Any],
                         unit: Optional[str],
                         company_name: str,
                         year: int,
                         quarter_int: int,
                         metric_name: str) -> Dict[str,Any]:
    """
    由数据表同行的列计算指标卡（当前值/同比差/环比差/与目标差距）。
    差值方向：当前值 - 对比值（正数=高于对比）。
    """
    cur = row.get("metric_value", None)
    tgt = row.get("baseline_target", None)
    yoy_base = row.get("last_year_value", None)
    qoq_base = row.get("last_period_value", None)

    def _delta(a, b):
        try:
            if a is None or b is None: return None
            return float(a) - float(b)
        except Exception:
            return None

    yoy_delta = _delta(cur, yoy_base)
    qoq_delta = _delta(cur, qoq_base)
    gap_delta = _delta(cur, tgt)

    return {
        "company": company_name,
        "time": f"{year}Q{quarter_int}",
        "metric": metric_name,
        "unit": unit,
        "current": cur,
        "current_str": fmt_num(cur) if cur is not None else None,
        "yoy_delta": yoy_delta,
        "yoy_delta_str": fmt_num(yoy_delta) if yoy_delta is not None else None,
        "qoq_delta": qoq_delta,
        "qoq_delta_str": fmt_num(qoq_delta) if qoq_delta is not None else None,
        "target_gap": gap_delta,  # 当前 - 目标（>0 表示超目标，<0 表示低于目标）
        "target_gap_str": fmt_num(gap_delta) if gap_delta is not None else None,
        "refs": {
            "baseline_target": tgt,
            "baseline_target_str": fmt_num(tgt) if tgt is not None else None,
            "last_year_value": yoy_base,
            "last_year_value_str": fmt_num(yoy_base) if yoy_base is not None else None,
            "last_period_value": qoq_base,
            "last_period_value_str": fmt_num(qoq_base) if qoq_base is not None else None,
            "source": row.get("source")
        }
    }

# ---------------- API ---------------- #
class QueryReq(BaseModel):
    question: Optional[str] = None
    metric: Optional[str] = None
    company: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[str] = None
    scenario: Optional[str] = "actual"

class QueryResp(BaseModel):
    need_clarification: bool = False
    ask: Optional[str] = None
    resolved: Optional[Dict[str,Any]] = None
    value: Optional[Dict[str,Any]] = None
    formula: Optional[Dict[str,Any]] = None
    indicator_card: Optional[Dict[str,Any]] = None
    message: Optional[str] = None
    # 新增：用于前端显露 3 个检查项 + 过程
    debug: Optional[Dict[str,Any]] = None
    steps: Optional[List[Dict[str,Any]]] = None



@app.post("/metrics/query", response_model=QueryResp)
def metrics_query(req: QueryReq, _=Depends(require_token)):
    print("[dataquery] REQ:", req.dict(), flush=True)   # ★新增
    steps: List[Dict[str,Any]] = []
    def log(title: str, status: str, **kw):
        # 统一的进度记录，前端只用 title/status 即可
        steps.append({"title": title, "status": status, **kw})

    # —— 显式 quarter 先规范化
    quarter_int_explicit = _parse_quarter_to_int(req.quarter)

    # —— 是否需要 LLM（缺任一项就需要）
    need_llm = not (req.metric and req.company and req.year and quarter_int_explicit)

    # 先把“意图识别”这一步写进去：纯取数= dataquery；否则 = deep
    log("分析问题中（意图识别）", "done", intent=("deep" if need_llm else "dataquery"))

    # —— 调试容器
    dbg: Dict[str, Any] = {"need_llm": need_llm}


    # —— 只有缺项时才调 LLM/正则
    parsed: Dict[str,Any] = {}
    reg: Dict[str,Any] = {}
    if need_llm and req.question:
        parsed = llm_structured_parse(req.question)
        reg = parse_question(req.question or "")
        llm_dbg = parsed.get("_debug") if isinstance(parsed, dict) else None
        steps.append({"stage": "llm_first", "called": True, "ok": bool(llm_dbg and llm_dbg.get("ok")),
                    "endpoint": (llm_dbg or {}).get("endpoint"), "elapsed_ms": (llm_dbg or {}).get("elapsed_ms")})
        dbg["llm_first"] = llm_dbg

    # —— 合并（显式 > LLM > 正则）
    metric_raw   = req.metric or parsed.get("metric")  or reg.get("metric")
    company_name = req.company or parsed.get("company") or reg.get("company")
    year         = req.year    or parsed.get("year")    or reg.get("year")
    quarter_int  = quarter_int_explicit or parsed.get("quarter") or reg.get("quarter")

    # --- relative time smart fallback ---
    canon_company = match_company_name(company_name) if company_name else None
    metric_text_for_match = " ".join([t for t in [metric_raw, req.question] if t])
    canon_metric = match_metric_canonical(metric_text_for_match) or (metric_raw or None)
    # 3.1) LLM 二次兜底：若规范化仍失败（或 metric 无法从别名表命中），用 LLM 再解析一次
    if req.question and (not canon_metric or not canon_company):
        parsed2 = llm_structured_parse(req.question)
        # 用 LLM 结果回填缺项
        company_name = company_name or parsed2.get("company")
        metric_raw   = metric_raw   or parsed2.get("metric")
        year         = year         or parsed2.get("year")
        quarter_int  = quarter_int  or parsed2.get("quarter")
        # 重新规范化（允许用 question 参与匹配放宽）
        canon_company = (match_company_name(company_name) or company_name) if company_name else None
        canon_metric  = (match_metric_canonical(metric_raw or req.question) or metric_raw) if (metric_raw or req.question) else None
        llm_dbg2 = parsed2.get("_debug") if isinstance(parsed2, dict) else None
        steps.append({"stage": "llm_second", "called": True, "ok": bool(llm_dbg2 and llm_dbg2.get("ok")),
              "endpoint": (llm_dbg2 or {}).get("endpoint"), "elapsed_ms": (llm_dbg2 or {}).get("elapsed_ms")})
        dbg["llm_second"] = llm_dbg2
    if (not year or not quarter_int) and req.question and _has_relative(req.question):
        y2, q2 = _infer_time_from_db(req.question, canon_company, canon_metric)
        year = year or y2
        quarter_int = quarter_int or q2

    # 3) catalog 规范化（若没命中仍保留原文以便 financial_metrics 能命中）
    canon_company = (match_company_name(company_name) or company_name) if company_name else None
    canon_metric  = (match_metric_canonical(metric_raw) or metric_raw) if metric_raw else None

    # 4) 缺项则明确追问
    missing = []
    if not canon_metric:  missing.append("指标")
    if not canon_company: missing.append("公司")
    if not year:          missing.append("年份")
    if not quarter_int:   missing.append("季度（Q1-Q4）")
    if missing:
        ask = "请补充：" + "、".join(missing) + "。"
        dbg["resolved_partial"] = {
            "metric_raw": metric_raw, "company_raw": company_name,
            "year": year, "quarter": quarter_int
        }
        return QueryResp(need_clarification=True, ask=ask, debug=dbg, steps=steps)


    # 5) 构造 resolved
    meta = metric_meta(canon_metric) or {}
    q_label = f"Q{quarter_int}"
    resolved = {
        "metric_canonical": canon_metric,
        "company_name": canon_company,
        "year": int(year),
        "quarter": q_label,
        "scenario": req.scenario or "actual",
    }
    print("[dataquery] RESOLVED:", resolved, flush=True)  # ★新增
    dbg["resolved"] = resolved
    # 6) 优先直取（并携带指标卡）
    row = fetch_metric_row(canon_company, int(year), int(quarter_int), canon_metric)
    if row and (row.get("metric_value") is not None):
        cur_val = None
        try:
            cur_val = float(row["metric_value"])
        except Exception:
            pass
        card = build_indicator_card(row, meta.get("unit"), canon_company, int(year), int(quarter_int), canon_metric)
        dbg["fetch_ok"] = True
        dbg["fetch_mode"] = "direct"
        dbg["source"] = row.get("source")
        # 把“取数/生成结果”记录进度
        log("取数中", "done")
        log("生成结果中", "done")
        return QueryResp(
            resolved=resolved,
            value={"metric_name": canon_metric, "metric_value": cur_val, "unit": meta.get("unit")},
            indicator_card=card,
            message="直取完成",
            debug=dbg, steps=steps
        )


    # 7) 再尝试公式（保持原逻辑，不构造指标卡）
    fml = load_formula(canon_metric)
    if not fml:
        dbg["fetch_ok"] = False
        dbg["fetch_mode"] = "formula_missing"
        return QueryResp(
            need_clarification=True,
            ask=f"未查到『{canon_metric}』的数值，且 metric_formulas 中无该指标公式。请先在 metric_formulas 上传 {canon_metric} 的公式（variables/compute），然后再试。",
            resolved=resolved,
            message="未找到直取值 & 缺少公式",
            debug=dbg, steps=steps
        )


    variables = fml.get("variables") or {}
    compute   = fml.get("compute") or {}
    if isinstance(variables, str):
        try: variables = json.loads(variables)
        except Exception: variables = {}
    if isinstance(compute, str):
        try: compute = json.loads(compute)
        except Exception: compute = {}

    try:
        result, steps_values, base_values, result_var = compute_by_formula(
            canon_metric, variables, compute,
            lambda base_cn: compute_or_fetch_metric(canon_company, int(year), int(quarter_int), base_cn, 1),
            env_hint={"company_name": canon_company, "year": int(year), "quarter": q_label}
        )
        dbg["fetch_ok"] = True
        dbg["fetch_mode"] = "formula"
        expr, substituted, table = make_expression(canon_metric, result_var, steps_values, variables, compute)
        
        log("取数中", "done")
        log("生成结果中", "done")       

        return QueryResp(
            resolved=resolved,
            formula={"expression": expr, "substituted": substituted, "result": result, "result_str": fmt_num(result), "table": table},
            message="公式计算完成", debug=dbg, steps=steps
        )
    except HTTPException as e:
        dbg["fetch_ok"] = False
        dbg["fetch_mode"] = "formula_need_base"
        return QueryResp(
            need_clarification=True,
            ask=f"计算『{canon_metric}』需要的基础指标缺失：{str(e.detail)}。请补充相关基础指标或完善公式后再试。",
            resolved=resolved,
            message="公式所需基础指标缺失", debug=dbg, steps=steps
        )
    except Exception as e:
        dbg["fetch_ok"] = False
        dbg["fetch_mode"] = "formula_error"
        return QueryResp(
            need_clarification=True,
            ask=f"『{canon_metric}』公式解析失败：{e}。请检查公式表。",
            resolved=resolved,
            message="公式解析失败", debug=dbg, steps=steps
        )
@app.get("/llm/ping")
def llm_ping():
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        raise HTTPException(400, "LLM 未配置（OPENAI_* / LLM_*）")
    try:
        r = requests.get(f"{LLM_BASE}/models",
                         headers={"Authorization": f"Bearer {LLM_KEY}"},
                         timeout=10)
        return {"ok": r.ok, "status": r.status_code, "model": LLM_MODEL, "base": LLM_BASE}
    except Exception as e:
        raise HTTPException(502, f"LLM ping failed: {e}")

@app.get("/healthz")
def healthz():
    return {"ok": True}
