# -*- coding: utf-8 -*-
from __future__ import annotations
import os, json, re, math
from typing import Any, Dict, Optional, List, Tuple

import requests
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(".env")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEV_BYPASS_AUTH = os.getenv("DEV_BYPASS_AUTH") == "true"

app = FastAPI(title="DataQuery Agent", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_origin_regex=".*",
    allow_methods=["GET","POST","OPTIONS"], allow_headers=["*"],
    expose_headers=["*"], allow_credentials=False, max_age=86400,
)

# ---------------- Common ---------------- #
async def require_token(authorization: str = Header(None)):
    if DEV_BYPASS_AUTH:
        return
    return

def _sb(path: str, params: Dict[str,Any]) -> Any:
    """Low-level Supabase REST GET"""
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

# ---------------- Alias catalog (name matching) ---------------- #
_ALIAS_CACHE: Dict[str,Dict[str,Any]] = {}

def load_metric_alias_cache(force: bool=False):
    """Cache canonical -> meta (for name matching / unit only)"""
    global _ALIAS_CACHE
    if _ALIAS_CACHE and not force:
        return
    rows = _sb_safe("metric_alias_catalog", {
        "select": "canonical_name,aliases,unit,is_derived,compute_key"
    })
    cache: Dict[str,Dict[str,Any]] = {}
    for r in rows:
        als = r.get("aliases") or []
        if isinstance(als, list):
            als = [str(x) for x in als if x is not None]
        else:
            als = []
        cache[str(r["canonical_name"])] = {
            "aliases": als,
            "unit": r.get("unit"),
            "is_derived": bool(r.get("is_derived")),
            "compute_key": r.get("compute_key") or r["canonical_name"],
        }
    _ALIAS_CACHE = cache

def match_metric_canonical(text: str) -> Optional[str]:
    """从中文问题或直接给的指标名里，匹配出标准中文名"""
    load_metric_alias_cache()
    t = (text or "").lower()
    best = None
    for canonical, meta in _ALIAS_CACHE.items():
        names = [canonical] + meta["aliases"]
        for n in names:
            s = str(n).strip()
            if not s:
                continue
            if s.lower() in t:
                if best is None or len(s) > len(best):
                    best = canonical
    return best

def metric_meta(canonical: str) -> Optional[Dict[str,Any]]:
    load_metric_alias_cache()
    return _ALIAS_CACHE.get(canonical)

# ---------------- Lightweight parser ---------------- #
YEAR_RE = re.compile(r"(20\d{2})")
QUARTER_RE = re.compile(r"(?:^|[^A-Za-z])Q([1-4])|第([一二三四1234])季", re.I)

def parse_question(question: str) -> Dict[str,Any]:
    """
    返回: {year:int, quarter:int(1-4), company:str, metric:str(中文标准名或原词)}
    """
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

# ---------------- financial_metrics fetch (ONLY 4 columns) ---------------- #
def fetch_metric_value(company_name: str, year: int, quarter: int, metric_name: str) -> Optional[float]:
    """
    精确匹配 financial_metrics：
      company_name == 中文公司名
      year         == int
      quarter      == int (1~4)
      metric_name  == 中文指标名
    """
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

# ---------------- Formula utils ---------------- #
def load_formula(metric_name_cn: str) -> Optional[Dict[str,Any]]:
    """
    从 metric_formulas 读取启用公式（metric_name=中文），优先 is_standard=true
    """
    rows = _sb_safe("metric_formulas", {
        "select": "metric_name,description,variables,compute,enabled,is_standard,id",
        "metric_name": f"eq.{metric_name_cn}",
        "enabled": "eq.true",
        "order": "is_standard.desc,id.desc",
        "limit": "1",
    })
    return rows[0] if rows else None

SAFE_FUNCS = {"abs": abs, "min": min, "max": max, "round": round, "sqrt": math.sqrt}

def safe_eval(expr: str, env: Dict[str, float]) -> float:
    # 仅允许四则与 SAFE_FUNCS
    return float(eval(expr, {"__builtins__": {}, **SAFE_FUNCS}, env))

def fmt_num(v: float) -> str:
    """格式化显示规则：
    - 绝对值 > 10000: 千分位，0 位小数
    - 绝对值 < 1: 4 位小数
    - 其它: 千分位，2 位小数
    """
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

def compute_by_formula(metric_cn: str,
                       variables: Dict[str, str],
                       compute_graph: Dict[str, str],
                       fetcher,
                       env_hint: Dict[str,Any]) -> Tuple[float, Dict[str,float], Dict[str,float], str]:
    """
    variables: { var_key -> 基础指标中文名 }
    compute_graph: { result_key/中间量 -> 表达式(以 var_key/中间量 为变量) }
    fetcher(base_name_cn) -> float | None  （允许递归计算）
    """
    # 1) 取基础指标
    base_vals: Dict[str, float] = {}
    missing: List[str] = []
    for var_key, base_cn in variables.items():
        v = fetcher(base_cn)  # 可能是直接取数，也可能递归代公式
        if v is None:
            missing.append(base_cn)
        else:
            base_vals[var_key] = v
    if missing:
        raise HTTPException(404, f"基础指标缺失：{', '.join(missing)}，请补充 {env_hint}")

    # 2) 逐步求解（允许中间量）
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
    """
    生成中文表达式 / 中文代入表达式 / 表格
    - 仅展示【基础变量】(variables 中的条目)
    - 不再把结果变量(如 roe/ROE)放入“指标/变量值”
    """
    rhs = compute[result_var]

    # 英文变量 → 中文（中间量没中文就保留原键）
    def replace_vars_with_cn(expr: str) -> str:
        out = expr
        for k in sorted(variables.keys(), key=len, reverse=True):
            out = re.sub(rf"\b{k}\b", variables[k], out)
        out = re.sub(rf"\b{result_var}\b", metric_cn, out)
        return out

    expr_cn_rhs = replace_vars_with_cn(rhs)
    expr = f"{metric_cn} = {expr_cn_rhs}"

    # 只收集【基础变量】的值（过滤掉结果变量及未映射项）
    cn2val: Dict[str, float] = {}
    for k, cn in variables.items():
        if k == result_var:
            continue  # 不展示结果
        if k in values and values[k] is not None:
            cn2val[cn] = float(values[k])

    # 代入：只把基础变量中文名替换为数值（按你的格式化规则）
    sub = expr_cn_rhs
    for cn in sorted(cn2val.keys(), key=len, reverse=True):
        sub = sub.replace(cn, fmt_num(cn2val[cn]))

    # 表格：同样仅显示基础变量
    table = [{"指标/变量": cn, "值": fmt_num(val)} for cn, val in cn2val.items()]

    return expr, sub, table



# ---------- 递归：某中文指标 -> (先直取，无则按其标准公式计算) ---------- #
def compute_or_fetch_metric(company: str, year: int, quarter: int, metric_cn: str, depth: int = 0) -> Optional[float]:
    if depth > 3:
        return None
    v = fetch_metric_value(company, year, quarter, metric_cn)
    if v is not None:
        return v
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

# ---------- 杜邦相关 ---------- #
DUPONT_WORDS = ("杜邦", "dupont")

def contains_dupont(text: str) -> bool:
    t = (text or "").lower()
    return any(w in t for w in ("dupont",)) or ("杜邦" in (text or ""))

def normalize_ratio(val: Optional[float]) -> Optional[float]:
    """将百分值(>1.2)转小数，如 13 -> 0.13；小于等于1.2视为已是小数"""
    if val is None:
        return None
    try:
        v = float(val)
    except Exception:
        return None
    return v/100.0 if v > 1.2 else v

def dupont_calc_roe(company: str, year: int, quarter: int) -> Optional[Dict[str,Any]]:
    """净利率×总资产周转率×权益乘数（结果按百分值返回）"""
    npm_raw = compute_or_fetch_metric(company, year, quarter, "净利率")
    tat_raw = compute_or_fetch_metric(company, year, quarter, "总资产周转率")
    em      = compute_or_fetch_metric(company, year, quarter, "权益乘数")

    npm = normalize_ratio(npm_raw)
    tat = normalize_ratio(tat_raw)

    if npm is None or tat is None or em is None:
        return None

    roe_decimal = npm * tat * float(em)            # 三因子
    roe_percent = roe_decimal * 100.0              # 对齐前端常见展示
    expr = "ROE = 净利率 × 总资产周转率 × 权益乘数 × 100"
    sub = f"{fmt_num(npm)} × {fmt_num(tat)} × {fmt_num(float(em))} × 100"
    table = [
        {"指标/变量": "净利率",     "值": fmt_num(npm)},
        {"指标/变量": "总资产周转率", "值": fmt_num(tat)},
        {"指标/变量": "权益乘数",         "值": fmt_num(float(em))},
    ]

    return {"result": roe_percent, "expression": expr, "substituted": sub, "table": table}

# ---------------- API ---------------- #
class QueryReq(BaseModel):
    question: Optional[str] = None
    metric: Optional[str] = None           # 中文或包含别名的文本
    company: Optional[str] = None          # 中文公司名
    year: Optional[int] = None
    quarter: Optional[str] = None          # 支持 "Q1"/"1"/2
    scenario: Optional[str] = "actual"

class QueryResp(BaseModel):
    need_clarification: bool = False
    ask: Optional[str] = None
    resolved: Optional[Dict[str,Any]] = None
    value: Optional[Dict[str,Any]] = None
    formula: Optional[Dict[str,Any]] = None
    message: Optional[str] = None

def _parse_quarter_to_int(q: Any) -> Optional[int]:
    if q is None: return None
    s = str(q).strip().upper()
    if s.startswith("Q"):
        s = s[1:]
    try:
        i = int(s)
        if i in (1,2,3,4):
            return i
    except Exception:
        pass
    return None

def _method_hint(question: Optional[str]) -> str:
    """dupont / standard"""
    q = question or ""
    if contains_dupont(q):
        return "dupont"
    # 用户写“比率/公式/公式法”也走标准公式；默认也是标准
    if any(k in q for k in ["比率", "公式法", "公式", "ratio"]):
        return "standard"
    return "standard"

@app.post("/metrics/query", response_model=QueryResp)
def metrics_query(req: QueryReq, _=Depends(require_token)):
    # 1) 解析自然语言
    parsed: Dict[str,Any] = {}
    if req.question:
        parsed = parse_question(req.question)

    # 2) 合并参数（显式优先）
    metric_raw = req.metric or parsed.get("metric")
    company_name = req.company or parsed.get("company")
    year = req.year or parsed.get("year")
    quarter_int = _parse_quarter_to_int(req.quarter) or parsed.get("quarter")

    # 3) 核验
    if not metric_raw:
        return QueryResp(need_clarification=True, ask="请提供需要查询的财务指标。")
    if not company_name or not year or not quarter_int:
        miss = []
        if not company_name: miss.append("公司名称")
        if not year: miss.append("年份")
        if not quarter_int: miss.append("季度（Q1-Q4）")
        return QueryResp(need_clarification=True, ask="请补充：" + "、".join(miss) + "。")

    # 4) 规范化指标中文名
    canonical = match_metric_canonical(metric_raw) or metric_raw
    meta = metric_meta(canonical) or {}
    q_label = f"Q{quarter_int}"
    resolved = {
        "metric_canonical": canonical,
        "company_name": company_name,
        "year": int(year),
        "quarter": q_label,
        "scenario": req.scenario or "actual",
    }

    method = _method_hint(req.question)

    # -------------- A. 若提到“杜邦”，优先用杜邦三因子求 ROE -------------- #
    if method == "dupont" and canonical in ("ROE", "净资产收益率"):
        dup = dupont_calc_roe(company_name, int(year), int(quarter_int))
        if dup is not None:
           return QueryResp(
            resolved=resolved,
            formula={
                "expression": dup["expression"],
                "substituted": dup["substituted"],
                "result": dup["result"],
                "result_str": fmt_num(dup["result"]),
                "table": dup["table"],
            },
            message="杜邦分解计算完成",
            )

        # 杜邦失败 → 尝试标准公式 → 再退到直取
        fml = load_formula(canonical)
        if fml:
            variables = fml.get("variables") or {}
            compute = fml.get("compute") or {}
            if isinstance(variables, str):
                try: variables = json.loads(variables)
                except Exception: variables = {}
            if isinstance(compute, str):
                try: compute = json.loads(compute)
                except Exception: compute = {}
            try:
                result, steps_values, base_values, result_var = compute_by_formula(
                    canonical, variables, compute,
                    lambda base_cn: compute_or_fetch_metric(company_name, int(year), int(quarter_int), base_cn, 1),
                    env_hint={"company_name": company_name, "year": int(year), "quarter": q_label},
                )
                expr, substituted, table = make_expression(canonical, result_var, steps_values, variables, compute)
                return QueryResp(resolved=resolved, formula={"expression": expr, "substituted": substituted, "result": result, "table": table})
            except HTTPException as he:
                pass  # 继续降级
        # 直取
        val = fetch_metric_value(company_name, int(year), int(quarter_int), canonical)
        if val is not None:
            return QueryResp(resolved=resolved, value={"metric_name": canonical, "metric_value": val, "unit": meta.get("unit")})
        return QueryResp(resolved=resolved, message="未能通过杜邦或标准公式计算，也没有查到原值。")

    # -------------- B. 常规：优先“标准公式”，失败再直取 -------------- #
    fml = load_formula(canonical)
    if fml:
        variables = fml.get("variables") or {}
        compute = fml.get("compute") or {}
        if isinstance(variables, str):
            try: variables = json.loads(variables)
            except Exception: variables = {}
        if isinstance(compute, str):
            try: compute = json.loads(compute)
            except Exception: compute = {}
        try:
            # fetcher 允许递归：基础项缺失会再次尝试“直取 or 该项的标准公式”
            result, steps_values, base_values, result_var = compute_by_formula(
                canonical, variables, compute,
                lambda base_cn: compute_or_fetch_metric(company_name, int(year), int(quarter_int), base_cn, 1),
                env_hint={"company_name": company_name, "year": int(year), "quarter": q_label}
            )
            expr, substituted, table = make_expression(canonical, result_var, steps_values, variables, compute)
            return QueryResp(
                resolved=resolved,
                formula={"expression": expr, "substituted": substituted, "result": result, "result_str": fmt_num(result), "table": table},
                message="公式计算完成",
            )

        except HTTPException as he:
            # 继续降级到直取
            pass

    # 直取（最后一步）
    try:
        val = fetch_metric_value(company_name, int(year), int(quarter_int), canonical)
    except Exception as e:
        raise HTTPException(500, f"查询出错：{e}")
    if val is not None:
        return QueryResp(resolved=resolved, value={"metric_name": canonical, "metric_value": val, "unit": meta.get("unit")})
    return QueryResp(resolved=resolved, message="未查询到结果。")

@app.get("/healthz")
def healthz():
    return {"ok": True}
