# -*- coding: utf-8 -*-
"""
ROE Decomposition Agent – 带 business_unit 版（表格输出）

- 识别 company(中文/别名)、year、quarter、method(ratio|dupont) 与 business_unit（集团/港口/金融/地产）
- 取数/缓存/显示名全部携带 business_unit，确保“XX港口公司”等口径不串
- 以表格返回（不再下发柱状图）；结论里显示中文公司名
"""

from __future__ import annotations
import os, io, json, re, requests
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, TypedDict

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------- 环境 ----------
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
CACHE_TTL_SECONDS = int(os.getenv("SUPABASE_CACHE_TTL_SECONDS", "600"))

OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com")
OPENAI_MODEL    = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

AGENT_TOKEN      = os.getenv("AGENT_TOKEN", "")
DEV_BYPASS_AUTH  = os.getenv("DEV_BYPASS_AUTH") == "true"

# ---------- FastAPI ----------
app = FastAPI(title="ROE Agent", version="0.6.0-bu")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    allow_credentials=False,
    max_age=86400,
)

# ---------- 内存缓存（加入 business_unit 列） ----------
STORE = pd.DataFrame(columns=[
    "year","quarter","company","business_unit",
    "revenue","net_income_parent","avg_total_assets","avg_equity_parent",
    "scenario"
])
REQUIRED_COLS = set(STORE.columns)
# 缓存键加 business_unit
SCOPE_LAST_SYNC: dict[tuple[str,int,str,str,str], datetime] = {}

# ---------- Supabase helpers ----------
def _sb_get_safe(path: str, params: dict):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return []
    r = requests.get(
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path.lstrip('/')}",
        params=params,
        headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()

def _sb(path: str, params: dict):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise RuntimeError("Supabase creds not set")
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path.lstrip('/')}"
    r = requests.get(
        url, params=params,
        headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
        timeout=15,
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    return r.json()

# ---------- 公司/板块解析 ----------
BU_ALIASES = {
    "集团": ["集团","总部","母公司"],
    "港口": ["港口","港务","港口公司"],
    "金融": ["金融","金控","财务公司"],
    "地产": ["地产","房地产","置业","地产业"],
}
def _detect_bu(text: str) -> Optional[str]:
    for bu, kws in BU_ALIASES.items():
        for kw in kws:
            if kw.lower() in text.lower():
                return bu
    return None

def _resolve_company_id(name_or_id: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]+", name_or_id):
        return name_or_id
    try:
        rows = _sb_get_safe("company_catalog", {
            "select": "company_id,display_name,aliases",
            "or": f"(display_name.eq.{name_or_id},aliases.cs.[\"{name_or_id}\"])",
            "limit": 1,
        })
        if rows:
            return rows[0]["company_id"]
    except Exception as e:
        print("[company resolve warn]", e)
    return name_or_id

def company_display_name(company_id: str, business_unit: Optional[str]) -> str:
    """按 (company_id, business_unit) 取显示名；拿不到就回退 id。"""
    try:
        params = {"select": "display_name", "company_id": f"eq.{company_id}", "limit": 1}
        if business_unit:
            params["business_unit"] = f"eq.{business_unit}"
        rows = _sb_get_safe("company_catalog", params)
        return (rows[0]["display_name"] if rows else company_id)
    except Exception:
        return company_id

def find_company_from_text(text: str) -> Optional[str]:
    """仅返回公司名字符串（用于后续解析 id）；business_unit 另行识别。"""
    try:
        rows = _sb_get_safe("company_catalog", {"select": "company_id,display_name,aliases"})
    except Exception as e:
        print("[company catalog warn]", e); rows = []
    t = text.lower()
    best = None
    for r in rows:
        names = [str(r.get("display_name") or "")]
        als = r.get("aliases") or []
        if isinstance(als, list): names += [str(a) for a in als]
        for name in names:
            n = name.strip()
            if not n: continue
            if n.lower() in t:
                if best is None or len(n) > len(best): best = n
    if not best:
        m = re.search(r'([\u4e00-\u9fa5A-Za-z0-9]+?(?:集团公司|港口公司|金融公司|地产公司|公司|集团))', text)
        if m: best = m.group(1)
    return best

# ---------- 解析 ----------
class Parsed(TypedDict, total=False):
    company: str; year:int; quarter:str; method:str; business_unit:str

def _chat_json(sys: str, user: str) -> dict:
    if not OPENAI_API_KEY:
        return {}
    try:
        r = requests.post(
            f"{OPENAI_BASE_URL.rstrip('/')}/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": OPENAI_MODEL, "temperature": 0,
                "messages": [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"},
            },
            timeout=25,
        )
        r.raise_for_status()
        return json.loads(r.json()["choices"][0]["message"]["content"])
    except Exception:
        return {}

def _infer_method(text: str) -> Optional[str]:
    t = text
    pos_dup = max(t.rfind("杜邦"), t.lower().rfind("dupont"))
    pos_rat = max(t.rfind("公式"), t.rfind("比值"))
    if pos_dup < 0 and pos_rat < 0: return None
    if pos_dup < 0: return "ratio"
    if pos_rat < 0: return "dupont"
    return "ratio" if pos_rat > pos_dup else "dupont"

def parse_intent(text: str) -> Parsed:
    sys = "把中文财务问题转成 JSON：company,year,quarter,method(dupont|ratio),business_unit(集团|港口|金融|地产)。缺则 null。"
    js = _chat_json(sys, f"问题：{text}") or {}
    if not js.get("year"):
        m = re.search(r"(20\d{2})", text);  js["year"] = int(m.group(1)) if m else None
    if not js.get("quarter"):
        m = re.search(r"Q([1-4])|第([一二三四1234])季", text, re.I)
        if m:
            q = m.group(1) or m.group(2); m2 = {"一":"1","二":"2","三":"3","四":"4"}
            js["quarter"] = f"Q{m2.get(q,q)}"
    if not js.get("method"):
        js["method"] = _infer_method(text)
    if not js.get("company"):
        guess = find_company_from_text(text)
        if guess: js["company"] = guess
    if not js.get("business_unit"):
        bu = _detect_bu(text);  js["business_unit"] = bu
    return {k: v for k, v in js.items() if v}

# ---------- 缓存 & 取数（全部带 business_unit） ----------
def _need_sync(k: tuple[str,int,str,str,str]) -> bool:
    ts = SCOPE_LAST_SYNC.get(k)
    return (ts is None) or (datetime.now(timezone.utc) - ts > timedelta(seconds=CACHE_TTL_SECONDS))

def sync_from_supabase(company_i: str, year: int, quarter: str, business_unit: Optional[str]):
    company_id = _resolve_company_id(company_i)
    q = int(str(quarter).replace("Q",""))

    names = [
        '营业收入','收入','Revenue',
        '归母净利润','净利润',
        '平均总资产','Average total assets',
        '平均归母净资产','平均股东权益','Average shareholders equity'
    ]
    def _q(v:str)->str: return f'"{v}"' if " " in v else v
    in_param = f"in.({','.join(_q(n) for n in names)})"

    params = {
        "select": "company_id,business_unit,year,quarter,metric_name,metric_value",
        "company_id": f"eq.{company_id}",
        "year": f"eq.{year}",
        "quarter": f"eq.{q}",
        "metric_name": in_param,
    }
    if business_unit:
        params["business_unit"] = f"eq.{business_unit}"

    rows = _sb("financial_metrics", params)

    def pick(*alias):
        for n in alias:
            hit = next((r for r in rows if r["metric_name"] == n), None)
            if hit: return hit["metric_value"]
        return None

    payload = {
        "year": year, "quarter": f"Q{q}", "company": company_id,
        "business_unit": business_unit or (rows[0]["business_unit"] if rows else None),
        "scenario": "actual",
        "revenue": pick('营业收入','收入','Revenue'),
        "net_income_parent": pick('归母净利润','净利润'),
        "avg_total_assets": pick('平均总资产','Average total assets'),
        "avg_equity_parent": pick('平均归母净资产','平均股东权益','Average shareholders equity'),
    }
    miss = [k for k, v in payload.items() if v is None and k not in ("scenario","business_unit")]
    if miss:
        raise HTTPException(404, f"no data: {year} {payload['quarter']} {company_id} {business_unit or ''}; missing {miss}")

    global STORE
    # 对齐所有列，避免 FutureWarning
    row_df = pd.DataFrame([payload], columns=STORE.columns)
    STORE = pd.concat([STORE, row_df], ignore_index=True).drop_duplicates()
    return {"ok": True}

def ensure_cached(company_i: str, year: int, quarter: Optional[str], scenario: str, business_unit: Optional[str]):
    company_id = _resolve_company_id(company_i)
    if quarter:
        k = (company_id, year, quarter, scenario, business_unit or "")
        if _need_sync(k):
            sync_from_supabase(company_id, year, quarter, business_unit)
            SCOPE_LAST_SYNC[k] = datetime.now(timezone.utc)
    else:
        for q in ("Q1","Q2","Q3","Q4"):
            k = (company_id, year, q, scenario, business_unit or "")
            if _need_sync(k):
                try:
                    sync_from_supabase(company_id, year, q, business_unit)
                    SCOPE_LAST_SYNC[k] = datetime.now(timezone.utc)
                except Exception:
                    pass

def get_row(year: int, quarter: Optional[str], company_i: str, scenario: str, business_unit: Optional[str]) -> pd.Series:
    company_id = _resolve_company_id(company_i)
    ensure_cached(company_id, year, quarter, scenario, business_unit)
    df = STORE
    cond = (df.year == year) & (df.company == company_id) & (df.scenario == scenario)
    if business_unit:
        cond &= (df.business_unit == business_unit)
    if quarter:
        cond &= (df.quarter == quarter)
    r = df[cond]
    if r.empty:
        raise HTTPException(404, f"no data: {year} {quarter or ''} {company_id} {business_unit or ''} {scenario}")
    return r.iloc[0]

# ---------- 业务计算 ----------
def pct(x: float) -> str: return f"{x*100:.2f}%"

def roe_ratio(r: pd.Series) -> float:
    if float(r.avg_equity_parent) == 0: raise HTTPException(400, "avg_equity_parent=0")
    return float(r.net_income_parent) / float(r.avg_equity_parent)

def roe_dupont(r: pd.Series) -> Dict[str,float]:
    rev = float(r.revenue); ni = float(r.net_income_parent)
    assets = float(r.avg_total_assets); eq = float(r.avg_equity_parent)
    if rev == 0 or assets == 0 or eq == 0: raise HTTPException(400, "zero in components")
    npm = ni / rev; at = rev / assets; em = assets / eq
    return {"npm": npm, "at": at, "em": em, "roe": npm * at * em}

# ---------- models ----------
class NLQReq(BaseModel): question: str
class Resp(BaseModel):
    need_clarification: bool = False
    ask: Optional[str] = None
    method: Optional[str] = None
    scope: Optional[Dict[str,Any]] = None
    roe: Optional[float] = None
    components: Optional[Dict[str,float]] = None
    table: Optional[list[dict]] = None
    chart_png_b64: Optional[str] = None
    conclusion: Optional[str] = None

# ---------- 鉴权 ----------
async def require_token(authorization: str = Header(None)):
    if DEV_BYPASS_AUTH or not AGENT_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    if authorization.split(" ",1)[1] != AGENT_TOKEN:
        raise HTTPException(403, "Invalid token")

# ---------- 路由 ----------
@app.post("/nlq", response_model=Resp)
def nlq(req: NLQReq, _=Depends(require_token)):
    p = parse_intent(req.question)
    missing = [k for k in ("company","year","quarter","method") if k not in p]
    if missing:
        tips=[]
        if "method"  in missing: tips.append("采用公式法还是杜邦法？")
        if "company" in missing: tips.append("请补充公司名称。")
        if "year"    in missing: tips.append("年份？")
        if "quarter" in missing: tips.append("季度（Q1-Q4）？")
        return Resp(need_clarification=True, ask="；".join(tips))

    bu_guess = p.get("business_unit") or _detect_bu(req.question)
    company_id = _resolve_company_id(p["company"])
    company_name = company_display_name(company_id, bu_guess)

    sc = {"year": int(p["year"]), "quarter": p["quarter"],
          "company_id": company_id, "company_name": company_name,
          "business_unit": bu_guess, "scenario": "actual"}

    r = get_row(sc["year"], sc["quarter"], company_id, "actual", bu_guess)

    if p["method"] == "ratio":
        roe = roe_ratio(r)
        table = [
            {"指标":"归母净利润","值": f"{float(r.net_income_parent):,.2f}"},
            {"指标":"平均归母净资产","值": f"{float(r.avg_equity_parent):,.2f}"},
            {"指标":"ROE（公式法）","值": f"{roe*100:.2f}%"},
        ]
        concl = f"{sc['year']}/{sc['quarter']} {company_name} ROE={roe*100:.2f}%（公式法）"
        return Resp(method="ratio", scope=sc, roe=roe, components={
            "numerator": float(r.net_income_parent),
            "denominator": float(r.avg_equity_parent),
        }, table=table, chart_png_b64=None, conclusion=concl)

    parts = roe_dupont(r)
    table = [
        {"指标":"净利率","值": f"{parts['npm']*100:.2f}%"},
        {"指标":"总资产周转率","值": f"{parts['at']:.2f}"},
        {"指标":"权益乘数","值": f"{parts['em']:.2f}"},
        {"指标":"ROE","值": f"{parts['roe']*100:.2f}%"},
    ]
    concl = (f"{sc['year']}/{sc['quarter']} {company_name} ROE={parts['roe']*100:.2f}%（"
             f"净利率{parts['npm']*100:.2f}% × 总资产周转率{parts['at']:.2f} × 权益乘数{parts['em']:.2f}）")
    return Resp(method="dupont", scope=sc, roe=parts["roe"], components=parts,
                table=table, chart_png_b64=None, conclusion=concl)

# ---------- 其他辅助 ----------
@app.post("/upload-csv")
async def upload(file: UploadFile = File(...), _=Depends(require_token)):
    df = pd.read_csv(io.BytesIO(await file.read()))
    miss = REQUIRED_COLS - set(df.columns)
    if miss: raise HTTPException(400, f"missing cols: {miss}")
    global STORE
    df = df[STORE.columns]
    STORE = pd.concat([STORE, df], ignore_index=True).drop_duplicates()
    return {"ok": True, "rows": len(df)}

@app.get("/data-preview")
def preview(n: int = 5): return STORE.head(n).to_dict("records")

@app.get("/healthz")
def ok(): return {"ok": True}
