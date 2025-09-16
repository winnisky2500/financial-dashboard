# -*- coding: utf-8 -*-
from __future__ import annotations
import os, json, time, math, re
from typing import Any, Dict, List, Optional
from enum import Enum

import requests
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from starlette.responses import JSONResponse, Response
from fastapi.responses import StreamingResponse        # ← 新增
import asyncio                                         # ← 新增

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from dotenv import load_dotenv, find_dotenv
import json, re
from math import isfinite

# 更鲁棒：无论在什么工作目录启动，都能找到.env.local
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
import datetime as _dt
import requests




# --- 在文件头部 imports 之后，确保顺序如下（替换原有 env 读取片段） ---
from dotenv import load_dotenv, find_dotenv
p = find_dotenv(".env.backend", raise_error_if_not_found=False)
load_dotenv(p, override=True)

LLM_BASE  = (os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or os.getenv("LLM_BASE_URL") or "").rstrip("/")
LLM_KEY   = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or ""
LLM_MODEL = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL") or ""
LLM_CONNECT_TIMEOUT = int(os.getenv("LLM_CONNECT_TIMEOUT") or 30)   # 原来 5
LLM_READ_TIMEOUT    = int(os.getenv("LLM_READ_TIMEOUT")    or 90)   # 原来 20
# 是否在维度下钻里隐藏完整表，仅输出 TOP 表（默认是）
COMPACT_DIMENSION_TABLES = (os.getenv("COMPACT_DIMENSION_TABLES") or "true").lower() == "true"
# === Google CSE for policy/news ===
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
GOOGLE_CSE_ID  = os.getenv("GOOGLE_CSE_ID", "").strip()


print("[deepanalysis LLM]", LLM_BASE, LLM_MODEL)  # 启动日志明确当前配置

# 开发期是否跳过鉴权
DEV_BYPASS_AUTH = (os.getenv("DEV_BYPASS_AUTH") or "true").lower() == "true"
# 思考结束0.5秒后再生成结果
THOUGHT_DELAY_MS = int(os.getenv("THOUGHT_DELAY_MS") or "600")  # 最少 0.6s
# 下游 dataquery_agent
DATA_AGENT_BASE_URL = (
    os.getenv("DATA_AGENT_BASE_URL") or os.getenv("DATA_API") or "http://127.0.0.1:18010"
)
DATA_AGENT_TOKEN = os.getenv("DATA_AGENT_TOKEN") or os.getenv("ROE_AGENT_TOKEN") or ""

# Supabase REST（读表）
SUPABASE_URL = (
    os.getenv("SUPABASE_URL")
    or os.getenv("NEXT_PUBLIC_SUPABASE_URL")  # 前端公钥也可用
)
SUPABASE_SERVICE_ROLE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")         # 只读场景可退化为 anon
)
if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
    raise RuntimeError("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量")

# ======= 可调提示词（可在 .env.local 用同名变量覆盖） =======
PROMPT_PLANNER = os.getenv("PROMPT_PLANNER", """
你是资深财务分析规划师。基于已解析的上下文（公司/指标/期间/已选下钻模式），
用5条以内中文要点列出“分析流程计划”（不要展开执行）：
1) 取数计划（要取哪些核心字段）；
2) 公式/公司/子公司匹配计划（若为指标/业务分解要指明公式名/变量名）；
3) 下钻分解计划（同比/环比、维度拆解等）；
4) 上下文政策计划（要关注哪些政策脉络/口径）；
5) 结论与建议的预期结构。
仅输出简短要点，不要多余解释。
""").strip()

PROMPT_ANALYST = os.getenv("PROMPT_ANALYST", """
你是资深财务分析师。输入：
- indicator_card：含最新值/同比/环比/目标差距
- resolved：公司/指标/期间/模式
- sections：本次所有子任务的结果（维度/业务/异动/政策等）

请先**读取所有 sections** 与 indicator_card，再给出高管可读的**一次性最终输出**，仅返回 JSON：
{
  "summary": "1) **指标整体描述**：…\\n2) **下钻要点**（合并维度/业务）：…\\n3) **高贡献项**：…；**异常项**：…\\n4) **政策影响（仅一次）**：…\\n5) **风险**：…；**建议方向**：…",
  "extra_sections": [
    {"title": "业务拆解", "message": "1) 本期贡献…\\n2) 同比/环比差异…"},
    {"title": "异动与归因", "message": "…"}
  ]
}
硬性要求：
- **必须**综合所有子任务再下结论；不要输出思考/步骤；不要重复绘图；信息不足也给出通用框架。
""").strip()




PROMPT_POLICY = os.getenv("PROMPT_POLICY", """
你是企业政策影响分析师。输入给你：
- resolved（公司/指标/期间）
- sections（已执行的下钻结果）
- policy_news（如有：来自 Google CSE 的政策/监管搜索命中，数组，每项含 title/link/snippet/source/date）

请结合 policy_news（若存在）与已知上下文，产出与该指标相关的“政策上下文”及可能的影响路径，JSON 返回：
{
  "title": "政策上下文",
  "message": "中文段落，覆盖政策名称/级别或关键条目、口径差异与影响机制；可引用policy_news的关键信息（不需要粘贴链接本身）",
  "table": [{"policy":"政策要点","impact":"可能影响路径","risk":"风险点/注意事项"}]
}
仅返回 JSON，不要多余文本；如信息不足，请给出合理的通用框架。
""").strip()

def _extract_json_block(s: str) -> Optional[dict]:
    """从 LLM 文本里提取 JSON（容忍被```json 包裹）"""
    if not s: return None
    import re, json as _json
    m = re.search(r"\{[\s\S]*\}$", s.strip())
    if not m:
        m = re.search(r"```json([\s\S]*?)```", s.strip(), re.I)
        if m: s = m.group(1)
    try: return _json.loads(s)
    except Exception: return None

def _down_headers(token: Optional[str]) -> dict:
    h = {"Content-Type": "application/json"}
    t = (token or "").strip()
    if t.lower().startswith("bearer "):
        h["Authorization"] = t
    elif t:
        h["Authorization"] = f"Bearer {t}"
    return h

def llm_chat(system: str, user: str, *, temperature: float = 0.3, want_json: bool = False):
    """
    适配 gpt-5/o4/o3：/responses + input，不发送 temperature；
    其它：/chat/completions + messages 可带 temperature。
    返回：want_json=True 时尝试提取 JSON，否则返回纯文本（None 表示失败）。
    """
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        return {} if want_json else None

    is_responses = str(LLM_MODEL).lower().startswith(("gpt-5", "o4", "o3"))
    endpoint = "/responses" if is_responses else "/chat/completions"
    url = f"{LLM_BASE}{endpoint}"

    if is_responses:
        payload = {
            "model": LLM_MODEL,
            "input": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ]
        }
    else:
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "temperature": temperature,
        }

    try:
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {LLM_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=(LLM_CONNECT_TIMEOUT, LLM_READ_TIMEOUT),
        )
        if not r.ok:
            # 返回更可读的错误，方便你在进度面板看到真正原因
            try:
                err = r.json()
            except Exception:
                err = {"text": r.text}
            return {} if want_json else None

        data = r.json()
        # —— 解析文本（多种返回形态） —— #
        text = None
        if isinstance(data, dict) and "output_text" in data:  # responses 直出
            text = data.get("output_text")
        if text is None and isinstance(data, dict) and "choices" in data and data["choices"]:
            ch0 = data["choices"][0]
            text = (ch0.get("message") or {}).get("content") or ch0.get("text")
        if text is None and isinstance(data, dict) and "output" in data and data["output"]:
            try:
                parts = data["output"][0].get("content", [])
                texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("text")]
                text = "\n".join(texts) if texts else None
            except Exception:
                pass

        if want_json:
            return _extract_json_block(text or "") or {}
        return (text or "").strip() or None
    except Exception:
        return {} if want_json else None


def _quarter_bounds(year: int, q: str) -> tuple[str, str]:
    qn = int(str(q).upper().replace("Q",""))
    start_month = (qn-1)*3 + 1
    end_month   = start_month + 2
    start = _dt.date(year, start_month, 1)
    # 取该季度最后一天（下季度第一天-1）
    if end_month == 12:
        end = _dt.date(year, 12, 31)
    else:
        end = _dt.date(year, end_month+1, 1) - _dt.timedelta(days=1)
    return (start.isoformat(), end.isoformat())

def _google_cse_policy_search(company_name: str|None, industry: str|None,
                              year: int, quarter: str, limit: int = 6) -> list[dict]:
    """
    用 Google CSE 搜索该季度内与行业/公司相关的政策与监管/口径动态。
    采用【正向约束】：权威域名白名单 + 政策/金融/监管等口径词必含，避免无关结果。
    返回：[{title, link, snippet, source, date}]
    """
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        return []
    qs, qe = _quarter_bounds(year, quarter)

    keys = [k for k in [industry, company_name] if k]

    extra = ""
    ind = (industry or "")
    if any(x in ind for x in ["港", "码头", "航运", "集装箱"]):
        extra = " (港口 OR 航运 OR 集装箱 OR 口岸 OR 通关 OR 货运)"
    elif "金融" in ind:
        extra = " (金融 OR 银行 OR 保险 OR 证券 OR 贷款 OR 融资)"
    elif ("地产" in ind) or ("房地产" in ind):
        extra = " (房地产 OR 土地 OR 预售 OR 住建 OR 融资监管)"

    kw = "(政策 OR 通知 OR 指引 OR 意见 OR 办法 OR 监管 OR 宏观 OR 货币政策 OR 税 OR 财政 OR 国资 OR 发改)"
    base = " ".join(keys) + f" {kw}{extra} {year}年"

    params = {
        "key": GOOGLE_API_KEY,
        "cx":  GOOGLE_CSE_ID,
        "q":   base,
        "num": min(max(limit,1),10),
        "sort": "date",
    }

    # 权威域名白名单（只保留这些或其子域）
    white_domains = [
        "gov.cn", "ndrc.gov.cn", "mof.gov.cn", "pbc.gov.cn", "csrc.gov.cn",
        "cbirc.gov.cn", "safe.gov.cn", "sasac.gov.cn", "stats.gov.cn",
        "mot.gov.cn", "customs.gov.cn", "sse.com.cn", "szse.cn",
        "people.com.cn", "xinhuanet.com", "ce.cn", "china.com.cn"
    ]
    def domain_ok(src: str) -> bool:
        return any(src.endswith(d) or (("." + d) in src) for d in white_domains)

    # 政策/金融/监管口径必含（标题+摘要）
    must_tokens = ["政策","通知","意见","办法","监管","宏观","货币","财政","税","国资","发改","银行","证券","保险","港口","航运","物流","口岸","通关","融资","贷款","住建","土地"]

    try:
        r = requests.get("https://www.googleapis.com/customsearch/v1", params=params, timeout=15)
        r.raise_for_status()
        items = r.json().get("items", []) or []
        out = []
        for it in items:
            title = it.get("title") or ""
            snip  = it.get("snippet") or ""
            src   = (it.get("displayLink") or "").lower()
            text  = (title + " " + snip)
            if not domain_ok(src):           # 1) 权威域名
                continue
            if not any(tok in text for tok in must_tokens):  # 2) 口径词
                continue
            out.append({
                "title":   title,
                "link":    it.get("link"),
                "snippet": snip,
                "source":  src,
                "date":    None
            })
        return out
    except Exception:
        return []

    
def _sb_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

import requests as _rq
def _sb_select(table: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = _rq.get(url, headers=_sb_headers(), params={"select": "*", **params}, timeout=20)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    return r.json()

def _norm(s: Optional[str]) -> str:
    import re as _re
    return _re.sub(r"\s+", "", (s or "").lower())

def _split_aliases(v: Any) -> List[str]:
    if v is None: return []
    if isinstance(v, list): return [str(x) for x in v]
    sv = str(v).strip()
    if sv.startswith("["):
        try: return [str(x) for x in json.loads(sv)]
        except Exception: pass
    import re as _re
    return [x.strip() for x in _re.split(r"[,\|/;；，、\s]+", sv) if x.strip()]
# === 映射：compute_key <-> canonical_name（中文） ===
def load_alias_maps(conn):
    rows = conn.execute("""
        select compute_key, canonical_name 
        from metric_alias_catalog
        where compute_key is not null and canonical_name is not null
    """).fetchall()
    key2cn = {r["compute_key"].strip(): r["canonical_name"].strip() for r in rows}
    cn2key = {v: k for k, v in key2cn.items()}
    return key2cn, cn2key

VAR_WORD = re.compile(r"\b[a-zA-Z_]\w*\b")

def evaluate_formula(conn, company, year, quarter, variables_json, compute_json):
    # 解析
    variables = json.loads(variables_json or "{}")
    compute = json.loads(compute_json or "{}")
    expr = next(iter(compute.values()), "")

    if not expr:
        return {"ok": False, "reason": "公式为空"}

    # 读映射
    key2cn, _ = load_alias_maps(conn)

    # 自动补全 variables：凡是表达式里出现、variables 又没有的计算键，补成中文名
    for k in set(VAR_WORD.findall(expr)):
        if k not in variables and k in key2cn:
            variables[k] = key2cn[k]

    if not variables:
        return {"ok": False, "reason": "公式缺少变量映射"}

    # 按中文名去事实表取值
    base_cn = [v for v in variables.values() if v]
    q = """
      select metric_name, metric_value
      from financial_metrics
      where company_name = ? and year = ? and quarter = ?
        and metric_name = any(?)
    """
    rows = conn.execute(q, [company, int(year), int(quarter), base_cn]).fetchall()
    name2val = {r["metric_name"]: float(r["metric_value"]) for r in rows if r["metric_value"] is not None}

    # 计算键 -> 数值
    key2val = {}
    missing = []
    for k, cn in variables.items():
        if cn in name2val:
            key2val[k] = name2val[cn]
        else:
            missing.append(cn)

    if missing:
        return {"ok": False, "reason": "基础指标缺失: " + "，".join(missing)}

    # 代入表达式
    substituted = expr
    for k, v in key2val.items():
        substituted = re.sub(rf"\b{k}\b", f"({v})", substituted)

    if VAR_WORD.search(substituted):  # 仍有未替换变量
        return {"ok": False, "reason": "存在未替换变量", "substituted": substituted}

    try:
        result = eval(substituted, {"__builtins__": {}})
        if not (isinstance(result, (int, float)) and isfinite(result)):
            return {"ok": False, "reason": "结果非数值", "substituted": substituted}
        return {"ok": True, "result": float(result), "substituted": substituted, "variables_cn": list(variables.values())}
    except Exception as e:
        return {"ok": False, "reason": f"计算异常: {e}", "substituted": substituted}
    
_CACHE_TTL = 60
_LAST_LOAD = 0.0
_COMPANIES: List[Dict[str, Any]] = []
_METRIC_ALIASES: List[Dict[str, Any]] = []
_FORMULAS: List[Dict[str, Any]] = []
_KEY2CANON: Dict[str, str] = {}
_ALIAS2CANON: Dict[str, str] = {}

def _rebuild_alias_maps():
    global _KEY2CANON, _ALIAS2CANON
    _KEY2CANON, _ALIAS2CANON = {}, {}
    for r in _METRIC_ALIASES:
        canon = (r.get("canonical_name") or "").strip()
        if not canon: continue
        ck = (r.get("compute_key") or "").strip()
        if ck: _KEY2CANON[ck] = canon
        for a in _split_aliases(r.get("aliases")) + [r.get("display_name_cn") or "", canon]:
            a = str(a).strip()
            if a: _ALIAS2CANON[a] = canon

def _reload_caches(force=False):
    global _LAST_LOAD, _COMPANIES, _METRIC_ALIASES, _FORMULAS
    now = time.time()
    if (now - _LAST_LOAD < _CACHE_TTL) and not force and _COMPANIES: return
    _COMPANIES = _sb_select("company_catalog", {"order": "id.asc"})
    _METRIC_ALIASES = _sb_select("metric_alias_catalog", {"order": "id.asc"})
    _FORMULAS = _sb_select("metric_formulas", {"order": "id.asc"})
    _rebuild_alias_maps()
    _LAST_LOAD = now

def fmt_num(v: Any) -> Optional[str]:
    try:
        if v is None: return None
        x = float(v)
        if math.isnan(x) or math.isinf(x): return None
        ax = abs(x)
        if ax > 10000: return f"{int(round(x)):,.0f}"
        if ax < 1:     return f"{x:.4f}"
        return f"{x:.2f}"
    except Exception:
        return None
    
def one_liner(text: Optional[str], max_len: int = 120) -> Optional[str]:
    """从多段文本中抽取一句“总体结论”（首句），并裁剪到合适长度。"""
    if not text:
        return None
    try:
        s = re.sub(r"\s+", " ", str(text).strip())
        # 以中文句号/英文句号/问号/叹号切首句
        import re as _re
        first = _re.split(r"[。.!?]\s*", s, maxsplit=1)[0] or s
        return (first[:max_len] + ("…" if len(first) > max_len else ""))
    except Exception:
        return str(text)[:max_len]

def match_company(text: str) -> Optional[Dict[str, Any]]:
    if not text: return None
    _reload_caches()
    t = _norm(text)
    best, score = None, -1
    for row in _COMPANIES:
        names = [row.get("display_name") or "", row.get("company_id") or ""] + _split_aliases(row.get("aliases"))
        for n in names:
            nn = _norm(n); s = 0
            if t == nn: s = 100
            elif t in nn or nn in t: s = 60
            else:
                a = set([t[i:i+2] for i in range(len(t)-1)]) if len(t) > 1 else {t}
                b = set([nn[i:i+2] for i in range(len(nn)-1)]) if len(nn) > 1 else {nn}
                inter = len(a & b); uni = len(a | b) or 1
                s = 50 * inter / uni
            if s > score: score, best = s, row
    return best

def canonical_metric(text: str) -> Optional[str]:
    if not text: return None
    _reload_caches()
    t = _norm(text)
    best, score = None, -1
    for row in _METRIC_ALIASES:
        canonical = row.get("canonical_name") or ""
        names = [canonical] + _split_aliases(row.get("aliases"))
        for n in names:
            nn = _norm(n); s = 0
            if t == nn: s = 100
            elif t in nn or nn in t: s = 60
            if s > score: score, best = s, canonical
    return best

def canon_from_key_or_alias(name: str) -> Optional[str]:
    _reload_caches()
    if name in _KEY2CANON: return _KEY2CANON[name]
    if name in _ALIAS2CANON: return _ALIAS2CANON[name]
    return None

def get_children(parent: Dict[str, Any] | str) -> List[Dict[str, Any]]:
    """
    严格父子关系：仅用 company_catalog 的 id 与 parent_id 精确匹配。
    - parent 可传公司行或其 id（字符串）
    - 返回所有满足 row.parent_id == parent.id 的公司行
    - 结果按 display_name 去重，避免 catalog 存在同名不同 id 导致重复/丢失
    """
    _reload_caches()

    if isinstance(parent, dict):
        pid = str(parent.get("id") or "").strip()
    else:
        pid = str(parent or "").strip()

    if not pid:
        return []

    # 1) 精确 parent_id 匹配
    children = [r for r in _COMPANIES if str(r.get("parent_id") or "").strip() == pid]

    # 2) 去重
    def _norm_name(x: str) -> str:
        return re.sub(r"\s+", "", str(x or "")).lower()

    seen_names, seen_ids, out = set(), set(), []
    for c in children:
        cid = str(c.get("id") or "").strip()
        cname = _norm_name(c.get("display_name") or "")
        if not cname:
            continue
        if cname in seen_names:
            continue
        if cid and cid in seen_ids:
            continue
        out.append(c)
        seen_names.add(cname)
        if cid:
            seen_ids.add(cid)
    return out






def find_formula(metric_name: str, label: Optional[str] = None, is_standard: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    _reload_caches()
    for f in _FORMULAS:
        if (f.get("metric_name") == metric_name and
            (label is None or f.get("formula_label") == label) and
            (is_standard is None or bool(f.get("is_standard")) == bool(is_standard)) and
            bool(f.get("enabled", True))):
            return f
    return None

def fetch_metric_row_by_name(company_name: str, metric_name: str, year: int, quarter_int: int) -> Optional[Dict[str, Any]]:
    rows = _sb_select("financial_metrics", {
        "company_name": f"eq.{company_name}",
        "metric_name": f"eq.{metric_name}",
        "year": f"eq.{year}",
        "quarter": f"eq.{quarter_int}",
        "limit": 1
    })
    return rows[0] if rows else None

def list_company_metrics_by_name(company_name: str, year: int, quarter_int: int) -> List[Dict[str, Any]]:
    return _sb_select("financial_metrics", {
        "company_name": f"eq.{company_name}",
        "year": f"eq.{year}",
        "quarter": f"eq.{quarter_int}",
        "order": "metric_name.asc"
    })


def llm_summarize(sections: List[Dict[str, Any]], tone: str = "analytical") -> Optional[str]:
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        return None

    system = ("你是资深企业财务分析师。基于给定的下钻结果，面向高管写一个简洁而有条理的中文总结，"
              "包含：总体结论、一句话归因、建议的下一步（最多3条）。避免重复原文数字，尽量做提炼。")
    user = json.dumps(sections, ensure_ascii=False, indent=2)

    try:
        # 1) 模型决定端点
        endpoint = "/responses" if str(LLM_MODEL).lower().startswith(("gpt-5", "o4", "o3")) else "/chat/completions"
        url = f"{LLM_BASE.rstrip('/')}{endpoint}"

        # 2) payload
        if endpoint == "/responses":
            payload = {
                "model": LLM_MODEL,
                "input": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user}
                ]
            }
        else:
            payload = {
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user}
                ],
                "temperature": 0.2
            }

        r = requests.post(url,
            headers={"Authorization": f"Bearer {LLM_KEY}", "Content-Type": "application/json"},
            json=payload, timeout=(LLM_CONNECT_TIMEOUT, LLM_READ_TIMEOUT))
        r.raise_for_status()

        data = r.json()
        content = data.get("output_text") if endpoint == "/responses" else data["choices"][0]["message"]["content"]
        return (content or "").strip()

    except Exception as e:
        print("[llm summarize warn]", e)


def get_indicator_card(question: str, company: Optional[str], metric: Optional[str], year: Optional[int], quarter: Optional[str]) -> Dict[str, Any]:
    # 若四要素齐，把 question 置空，强制 dataquery 走“确定性路径”
    q = (question or "").strip()
    if company and metric and year and quarter:
        q = ""
    payload = {"question": q, "company": company, "metric": metric, "year": year, "quarter": quarter, "scenario": "actual"}
    r = requests.post(
        f"{DATA_AGENT_BASE_URL}/metrics/query",
        headers=_down_headers(DATA_AGENT_TOKEN),
        json=payload,
        timeout=30
    )
    if r.status_code >= 400: 
        raise HTTPException(502, f"dataquery_agent 调用失败: {r.text}")
    return r.json()


def safe_eval_compute(expr: str, vals: Dict[str, float]) -> float:
    allow = set("0123456789.+-*/() ")
    cleaned = []; i = 0
    while i < len(expr):
        ch = expr[i]
        if ch.isalpha() or ch == "_":
            j = i+1
            while j < len(expr) and (expr[j].isalnum() or expr[j] == "_"): j += 1
            name = expr[i:j]
            if name not in vals: raise ValueError(f"未知变量: {name}")
            cleaned.append(str(vals[name])); i = j; continue
        if ch in allow: cleaned.append(ch); i += 1; continue
        raise ValueError(f"非法字符: {ch}")
    return float(eval("".join(cleaned), {"__builtins__": {}}))

def contribution_by_variables(expr: str, base_vals: Dict[str, float], new_vals: Dict[str, float]) -> List[Dict[str, Any]]:
    res = []
    try:
        base_y = safe_eval_compute(expr, base_vals)
        new_y  = safe_eval_compute(expr, new_vals)
    except Exception as e:
        return [{"variable":"_error","message":f"计算失败: {e}"}]
    total_delta = new_y - base_y
    for k in new_vals.keys():
        mid = dict(base_vals); mid[k] = new_vals[k]
        try:
            mid_y = safe_eval_compute(expr, mid); impact = mid_y - base_y
        except Exception:
            impact = None
        res.append({"variable":k,"base":base_vals.get(k),"new":new_vals.get(k),"impact_estimate":impact})
    res.append({"variable":"_total","impact_estimate":total_delta})
    return res

def _parse_formula(f: Dict[str, Any]) -> Dict[str, Any]:
    vars_raw = f.get("variables"); comp_raw = f.get("compute")
    if isinstance(vars_raw, str):
        try: vars_raw = json.loads(vars_raw)
        except Exception: pass
    if isinstance(vars_raw, dict):
        var_keys = list(vars_raw.keys()); var_cn_map = dict(vars_raw)
    elif isinstance(vars_raw, list):
        var_keys = [str(x) for x in vars_raw]; var_cn_map = {k:k for k in var_keys}
    else:
        var_keys, var_cn_map = [], {}
    if isinstance(comp_raw, str): expr = comp_raw
    elif isinstance(comp_raw, dict):
        keys = list(comp_raw.keys())
        prefer = None
        for k in ["roe","result","value","y","metric"]:
            if k in comp_raw:
                prefer = k; break
        expr = comp_raw.get(prefer, comp_raw.get(keys[-1], ""))

    else: expr = ""
    used_tokens = set(re.findall(r"\b[a-zA-Z_]\w*\b", expr))
    ordered_vars = [k for k in var_keys if k in used_tokens] or var_keys
    return {"expr":expr,"var_keys":ordered_vars,"var_cn_map":var_cn_map}

# —— 新增：compute_key → 中文公式
def expr_to_cn(expr: str, cn_map: Dict[str, str]) -> str:
    if not expr: return expr
    tokens = sorted(set(re.findall(r"\b[a-zA-Z_]\w*\b", expr)), key=len, reverse=True)
    out = expr
    for k in tokens:
        cn = canon_from_key_or_alias(k) or cn_map.get(k, k)
        out = re.sub(rf"\b{k}\b", cn, out)
    return out

# —— 新增：兜底文字总结
def build_basic_summary(indicator_card: Optional[Dict[str, Any]], sections: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    if indicator_card:
        name = indicator_card.get("metric") or "该指标"
        comp = indicator_card.get("company") or ""
        when = indicator_card.get("time") or ""
        yoy = indicator_card.get("yoy_delta_str") or indicator_card.get("yoy_delta")
        qoq = indicator_card.get("qoq_delta_str") or indicator_card.get("qoq_delta")
        tgt = indicator_card.get("target_gap_str")
        p1 = f"{comp}·{when} 的「{name}」已完成最新取数。"
        if yoy is not None or qoq is not None:
            p1 += f" 同比：{yoy if yoy is not None else '-'}；环比：{qoq if qoq is not None else '-'}。"
        if tgt is not None: p1 += f" 与目标差距：{tgt}。"
        lines.append(p1)
    for s in sections:
        t = s.get("type")
        if t == "dimension" and s.get("conclusion"):
            ytop = s["conclusion"].get("yoy_top") or []
            qtop = s["conclusion"].get("qoq_top") or []
            if ytop: lines.append(f"同比看，「{ytop[0]['company']}」贡献/拖累最大（Δ={ytop[0].get('yoy_delta_str') or fmt_num(ytop[0].get('yoy_delta'))}）。")
            if qtop: lines.append(f"环比看，「{qtop[0]['company']}」贡献/拖累最大（Δ={qtop[0].get('qoq_delta_str') or fmt_num(qtop[0].get('qoq_delta'))}）。")
        if t in {"metric","business"}:
            rows = s.get("contribution_yoy") or []
            rows = [r for r in rows if r.get("variable") not in {"合计"} and isinstance(r.get("impact_raw"), (int,float))]
            rows.sort(key=lambda r: abs(r.get("impact_raw",0)), reverse=True)
            if rows[:2]:
                k = "；".join([f"「{r['variable']}」≈{r.get('impact') or fmt_num(r.get('impact_raw'))}" for r in rows[:2]])
                lines.append(f"分项归因：主要由 {k} 驱动（估算贡献）。")
        if t == "anomaly":
            ty = (s.get("top_yoy") or [])[:1]; tq = (s.get("top_qoq") or [])[:1]
            if ty: lines.append(f"同比异动首位：{ty[0]['metric']}（Δ={ty[0].get('yoy_change_str') or fmt_num(ty[0].get('yoy_change'))}）。")
            if tq: lines.append(f"环比异动首位：{tq[0]['metric']}（Δ={tq[0].get('qoq_change_str') or fmt_num(tq[0].get('qoq_change'))}）。")
    if sections: lines.append("建议：① 对贡献最大的分项/子公司做明细复核；② 校验口径与一次性因素；③ 如有目标差距，制定专项追赶方案。")
    return "\n".join(lines)

def _wrap_contrib_rows(contrib: List[Dict[str, Any]], cn_map: Dict[str,str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in contrib:
        key = item.get("variable")
        if key == "_error": rows.append(item); continue
        cname = "合计" if key == "_total" else (canon_from_key_or_alias(key) or cn_map.get(key) or key)
        base = item.get("base"); newv = item.get("new"); imp = item.get("impact_estimate")
        rows.append({
            "variable": cname, "base": fmt_num(base), "new": fmt_num(newv), "impact": fmt_num(imp),
            "variable_key": key, "base_raw": base, "new_raw": newv, "impact_raw": imp,
        })
    return rows

def _drill_dimension(company_row: Dict[str, Any], metric_name: str, year: int, quarter_int: int, top_k: int = 3) -> Dict[str, Any]:

    """
    维度下钻（严格要求）：
    1) 用 company_catalog.id → parent_id 找到所有子公司；
    2) 拿子公司 display_name；
    3) 逐个调用 dataquery_agent /metrics/query 取 {current, yoy_delta, qoq_delta}；
    4) 汇总表格与**单个**饼图（避免重复图表）。
    """
    children = get_children(company_row)
    found_names = [str(c.get("display_name") or "").strip() for c in children if c.get("display_name")]  # [ADD]
    probe: List[Dict[str, Any]] = []  # [ADD] 逐个子公司取数的成功/失败记录


    if not children:
        return {
            "type": "dimension",
            "title": "维度下钻",
            "message": "没有子公司可下钻。",
            "table": [],
            "chart": {"type": "pie", "data": []},
            "conclusion": {"yoy_top": [], "qoq_top": []},
            "debug": {"children_found": [], "data_calls": []}  # [ADD]
        }


    rows = []
    for c in children:
        child_name = str(c.get("display_name") or "").strip()
        if not child_name:
            continue

        payload = {
            "question": "",                       # 避免再走 LLM
            "company": child_name,
            "metric": metric_name,                # 已在上游 canonical 过
            "year": int(year),
            "quarter": f"Q{int(quarter_int)}",
            "scenario": "actual"
        }
        try:
            r = requests.post(
                f"{DATA_AGENT_BASE_URL}/metrics/query",
                headers=_down_headers(DATA_AGENT_TOKEN),
                json=payload,
                timeout=30
            )

            if r.status_code >= 400:
                probe.append({"name": child_name, "ok": False, "reason": f"HTTP {r.status_code}"})  # [ADD]
                continue

            dq = r.json() or {}
            card = dq.get("indicator_card") or {}
            cur = card.get("current")
            yoy = card.get("yoy_delta")
            qoq = card.get("qoq_delta")

            if cur is None and yoy is None and qoq is None:
                probe.append({"name": child_name, "ok": False, "reason": "no values"})  # [ADD]
                continue

            rows.append({
                "company": child_name,
                "current": cur, "current_str": fmt_num(cur),
                "yoy_delta": yoy, "yoy_delta_str": fmt_num(yoy),
                "qoq_delta": qoq, "qoq_delta_str": fmt_num(qoq),
            })
            probe.append({"name": child_name, "ok": True, "current": cur})  # [ADD]
        except Exception as e:
            probe.append({"name": child_name, "ok": False, "reason": str(e)})  # [ADD]
            continue

    if not rows:
        return {
            "type": "dimension",
            "title": "维度下钻",
            "message": "子公司在该期未检索到有效数据。",
            "table": [],
            "chart": {"type": "pie", "data": []},
            "conclusion": {"yoy_top": [], "qoq_top": []},
            "debug": {"children_found": found_names, "data_calls": probe}  # [ADD]
        }


    # TOP（按绝对变动）
    def _abs_or_neg1(v): return abs(v) if isinstance(v, (int, float)) else -1
    yoy_top = sorted(rows, key=lambda x: _abs_or_neg1(x.get("yoy_delta")), reverse=True)[:max(1, int(top_k))]
    qoq_top = sorted(rows, key=lambda x: _abs_or_neg1(x.get("qoq_delta")), reverse=True)[:max(1, int(top_k))]

    # **只绘制一个**饼图（当前值占比）
    chart = {"type": "pie", "data": [{"name": r["company"], "value": r.get("current") or 0} for r in rows]}

    ok_names = [p["name"] for p in probe if p.get("ok")]
    fail_names = [p["name"] for p in probe if not p.get("ok")]
    tip = f"（子公司共{len(found_names)}家，成功{len(ok_names)}，未命中{len(fail_names)}）"

    # 👇 精简模式：隐藏完整表，仅保留 TOP 和饼图；完整表塞到 debug.table_full
    table_to_return = [] if COMPACT_DIMENSION_TABLES else rows
    debug_extra = {
        "children_found": found_names,
        "data_calls": probe,
        "table_full": rows if COMPACT_DIMENSION_TABLES else None
    }

    return {
        "type": "dimension",
        "title": "维度下钻",
        "message": f"从子公司层面看，展示同比/环比 TOP{max(1, int(top_k))} 与当前值占比饼图。" + tip,
        "conclusion": {"yoy_top": yoy_top, "qoq_top": qoq_top},
        "table": table_to_return,       # ← 精简：这里为空数组时前端自然不再渲染第三张表
        "chart": chart,
        "debug": debug_extra
    }






def _drill_metric(company_row: Dict[str, Any], metric_name: str, year: int, quarter_int: int) -> Dict[str, Any]:
    f = find_formula(metric_name, is_standard=True) or find_formula(metric_name, label="标准公式")
    if not f: return {"type":"metric","title":"指标下钻","message": f"未找到『{metric_name}』的标准公式，无法指标下钻。"}
    pf = _parse_formula(f); expr = pf["expr"]; var_keys = pf["var_keys"]; cn_map = pf["var_cn_map"]
    if not expr or not var_keys: return {"type":"metric","title":"指标下钻","message":"标准公式定义不完整（缺少 variables/compute）。"}

    # 🔧 兜底：若 variables 里缺少某计算键，按别名表补成中文（如 net_profit_margin → 净利率）
    for k in set(re.findall(r"\b[a-zA-Z_]\w*\b", expr)):
        if k not in cn_map:
            cn = canon_from_key_or_alias(k)
            if cn: cn_map[k] = cn

    base_vals, new_vals = {}, {}
    for k in var_keys:
        cn = cn_map.get(k, k)
        r_cur = fetch_metric_row_by_name(company_row.get("display_name"), cn, year, quarter_int)
        if r_cur and r_cur.get("metric_value") is not None and r_cur.get("last_year_value") is not None:
            new_vals[k]  = r_cur.get("metric_value"); base_vals[k] = r_cur.get("last_year_value")

    tokens = set(re.findall(r"\b[a-zA-Z_]\w*\b", expr))
    new_vals = {k:v for k,v in new_vals.items() if k in tokens}
    base_vals = {k:v for k,v in base_vals.items() if k in tokens}

    contrib_rows = _wrap_contrib_rows(contribution_by_variables(expr, base_vals, new_vals), cn_map)
    return {
        "type":"metric","title":"指标下钻（标准公式）",
        "formula":{
            "variables":[canon_from_key_or_alias(k) or cn_map.get(k, k) for k in var_keys],
            "variables_cn":[canon_from_key_or_alias(k) or cn_map.get(k, k) for k in var_keys],
            "compute":expr,"compute_cn":expr_to_cn(expr, cn_map)
        },
        "contribution_yoy":contrib_rows,
        "note":"贡献估算基于逐个变量替换法，作为定性解释。"
    }

def _drill_business(company_row: Dict[str, Any], metric_name_for_biz: str, year: int, quarter_int: int) -> Dict[str, Any]:
    f = find_formula(metric_name_for_biz, label="业务公式") or find_formula(metric_name_for_biz, is_standard=False)
    if not f: return {"type":"business","title":"业务下钻","message": f"未找到『{metric_name_for_biz}』的业务公式。"}
    pf = _parse_formula(f); expr = pf["expr"]; var_keys = pf["var_keys"]; cn_map = pf["var_cn_map"]
    if not expr or not var_keys: return {"type":"business","title":"业务下钻","message":"业务公式定义不完整（缺少 variables/compute）。"}

    # 🔧 兜底：把缺失的计算键补成中文
    for k in set(re.findall(r"\b[a-zA-Z_]\w*\b", expr)):
        if k not in cn_map:
            cn = canon_from_key_or_alias(k)
            if cn: cn_map[k] = cn

    base_vals, new_vals = {}, {}
    for k in var_keys:
        cn = cn_map.get(k, k)
        r_cur = fetch_metric_row_by_name(company_row.get("display_name"), cn, year, quarter_int)
        if r_cur and r_cur.get("metric_value") is not None and r_cur.get("last_year_value") is not None:
            new_vals[k]  = r_cur.get("metric_value"); base_vals[k] = r_cur.get("last_year_value")

    tokens = set(re.findall(r"\b[a-zA-Z_]\w*\b", expr))
    new_vals = {k:v for k,v in new_vals.items() if k in tokens}
    base_vals = {k:v for k,v in base_vals.items() if k in tokens}

    contrib_rows = _wrap_contrib_rows(contribution_by_variables(expr, base_vals, new_vals), cn_map)
    return {
        "type":"business","title":f"业务下钻（{metric_name_for_biz}）",
        "formula":{
            "variables":[canon_from_key_or_alias(k) or cn_map.get(k, k) for k in var_keys],
            "variables_cn":[canon_from_key_or_alias(k) or cn_map.get(k, k) for k in var_keys],
            "compute":expr,"compute_cn":expr_to_cn(expr, cn_map)
        },
        "contribution_yoy":contrib_rows,
        "note":"贡献估算基于逐个变量替换法，作为定性解释。"
    }

class DrillMode(str, Enum):
    dimension="dimension"; metric="metric"; business="business"; anomaly="anomaly"

class AnalyzeReq(BaseModel):
    question: str
    company: Optional[str] = None
    metric: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[str] = None
    modes: List[DrillMode] = Field(default_factory=list)
    business_formula_metric_name: Optional[str] = None
    top_k: int = 3
    # 新增：控制政策段
    skip_policy: bool = False
    policy_only: bool = False


class AnalyzeResp(BaseModel):
    indicator_card: Optional[Dict[str, Any]] = None
    resolved: Optional[Dict[str, Any]] = None
    sections: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Optional[str] = None
    # 新增：运行进度（前端可直接渲染）
    progress: List[Dict[str, Any]] = Field(default_factory=list)
# === 新增：核心执行函数，可被同步/流式两个入口复用 ===
def _analyze_core(req: AnalyzeReq, on_push=None) -> AnalyzeResp:
    """
    on_push: 可选回调，形如 on_push(event_dict)，用于将每一步进度向外推送；
             event_dict = {"step": "...", "status": "start|done|error", "elapsed_ms": int, "detail": "..."}
    返回值：AnalyzeResp（与你原 analyze 的返回一致）
    """
    t0 = time.time()
    progress: List[Dict[str, Any]] = []
    def push(step: str, status: str, detail: Optional[str] = None):
        ev = {
            "step": step,
            "status": status,
            "elapsed_ms": int((time.time() - t0) * 1000),
            **({"detail": str(detail)} if detail else {})
        }
        progress.append(ev)
        if callable(on_push):
            try: on_push(ev)
            except Exception: pass

    # —— 下面这段逻辑，基本照搬你原 analyze() 的主体，只把“push(...)”替换为上面定义的 push —— #
    # 1) 取数（指标卡）
    push("取数中", "start")
    dq = get_indicator_card(req.question, req.company, req.metric, req.year, req.quarter)
    push("取数中", "done")
    indicator_card = dq.get("indicator_card")

    resolved_dq = dq.get("resolved") or {}
    company_name = resolved_dq.get("company") or resolved_dq.get("company_name") or req.company
    metric_name  = resolved_dq.get("metric")  or resolved_dq.get("metric_canonical") or req.metric
    year         = int(resolved_dq.get("year") or req.year or 2025)
    q_str        = str(resolved_dq.get("quarter") or req.quarter or "Q2").upper()
    quarter_int  = int(q_str.replace("Q", "")) if "Q" in q_str else int(q_str)

    comp_row = match_company(company_name or "")
    if not comp_row:
        raise HTTPException(404, f"无法识别公司：{company_name}")
    canon_metric = canonical_metric(metric_name or "") or (metric_name or "")

    sections: List[Dict[str, Any]] = []

    # (A) 规划
    push("分析问题中（意图识别/规划）", "start")
    try:
        plan_ctx = {
            "company": comp_row.get("display_name") or comp_row.get("company_id"),
            "metric": canon_metric, "year": year, "quarter": quarter_int,
            "modes": [m.value for m in req.modes],
        }
        plan = llm_chat(PROMPT_PLANNER, json.dumps(plan_ctx, ensure_ascii=False), temperature=0.2) or ""
        push("分析问题中（意图识别/规划）", "done",
             detail=(str(plan).strip()[:300] + ("..." if len(str(plan)) > 300 else "")) if plan else None)
    except Exception as e:
        push("分析问题中（意图识别/规划）", "error", detail=e)

    # (B) 下钻
    if not req.policy_only and req.modes:
        push("下钻执行中", "start")
        for mode in req.modes:
            if mode == DrillMode.dimension:
                sections.append(_drill_dimension(comp_row, canon_metric, year, quarter_int, max(1, int(req.top_k))))
            elif mode == DrillMode.metric:
                sections.append(_drill_metric(comp_row, canon_metric, year, quarter_int))
            elif mode == DrillMode.business:
                biz_metric = req.business_formula_metric_name or canon_metric
                sections.append(_drill_business(comp_row, biz_metric, year, quarter_int))
            elif mode == DrillMode.anomaly:
                sections.append(_drill_anomaly(comp_row, year, quarter_int, max(1, int(req.top_k))))
            else:
                sections.append({"type": "unknown", "message": f"未知模式：{mode}"})
        push("下钻执行中", "done")

    #     # (C) 政策上下文
    # if not req.skip_policy:
    #     try:
    #         # ① 先做“政策候选检索”并把结果明确写进进度与 sections
    #         push("政策检索（候选）", "start")
    #         industry = (comp_row.get("business_unit")) or None

    #         policy_hits = []
    #         # if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
    #         #     # 未配置密钥：明确告诉前端“为什么没有去检索”
    #         #     push("政策检索（候选）", "done", detail="未配置 GOOGLE_API_KEY/CSE_ID，跳过检索")
    #         #     sections.append({
    #         #         "type": "policy_info",
    #         #         "title": "政策检索状态",
    #         #         "message": "未配置 GOOGLE_API_KEY/CSE_ID，跳过政策候选检索；下文仅给出通用框架。"
    #         #     })
    #         # else:
    #         #     try:
    #         #         policy_hits = _google_cse_policy_search(
    #         #             company_name=plan_ctx["company"],
    #         #             industry=industry,
    #         #             year=year,
    #         #             quarter=f"Q{quarter_int}",
    #         #             limit=6
    #         #         )
    #         #         push("政策检索（候选）", "done", detail=f"{len(policy_hits)} 条")
    #         #     except Exception as e:
    #         #         # 检索异常：也要把原因回传到进度里
    #         #         policy_hits = []
    #         #         push("政策检索（候选）", "done", detail=f"检索失败：{e}")
    #         #         sections.append({
    #         #             "type": "policy_info",
    #         #             "title": "政策检索状态",
    #         #             "message": f"政策候选检索失败：{e}"
    #         #         })
    #         # # 把候选清单单独落一节（先展示列表，再做影响分析）
    #         # # —— 原来这里直接开始拼 policy_candidates / 做政策上下文 —— 
    #         # # 现在改成：
    #         # if not req.skip_policy:
    #         #     # 把候选清单单独落一节（先展示列表，再做影响分析）
    #         #     if policy_hits:
    #         #         sections.append({
    #         #             "type": "policy_candidates",
    #         #             "title": "政策候选清单",
    #         #             "table": [{"title": h.get("title"), "source": h.get("source"), "snippet": h.get("snippet")} for h in policy_hits]
    #         #         })

    #         #     # ② 再做“政策上下文/影响路径”的 LLM 归纳
    #         #     push("调用分析agent大模型中（政策上下文）", "start")
    #         #     pol_ctx = {
    #         #         "resolved": {"company": plan_ctx["company"], "metric": canon_metric, "year": year, "quarter": quarter_int},
    #         #         "sections": sections,
    #         #         "policy_news": policy_hits
    #         #     }
    #         #     pol_json = llm_chat(PROMPT_POLICY, json.dumps(pol_ctx, ensure_ascii=False), want_json=True, temperature=0.3)
    #         #     if isinstance(pol_json, dict) and (pol_json.get("message") or pol_json.get("table") or pol_json.get("chart")):
    #         #         sections.append({"type": "policy", **pol_json})
    #         #     push("调用分析agent大模型中（政策上下文）", "done",
    #         #         detail=(pol_json.get("message")[:200] if isinstance(pol_json, dict) and pol_json.get("message") else None))
    #         # # ← 这一大段包裹结束

    #     except Exception as e:
    #         push("调用分析agent大模型中（政策上下文）", "error", detail=e)

    # if req.policy_only:
    #     return AnalyzeResp(indicator_card=None, resolved=plan_ctx, sections=sections, summary=None, progress=progress)

    # (D) 最终整理
    push("调用分析agent大模型中（最终整理）", "start")
    final_ctx = {"indicator_card": indicator_card, "resolved": plan_ctx, "sections": sections}
    final_json = llm_chat(PROMPT_ANALYST, json.dumps(final_ctx, ensure_ascii=False), want_json=True, temperature=0.2)
    llm_summary = None
    if isinstance(final_json, dict):
        llm_summary = final_json.get("summary")
        extra = final_json.get("extra_sections") or []
        for s in extra:
            if isinstance(s, dict) and (s.get("message") or s.get("table") or s.get("chart")):
                sections.append(s)

    summary = llm_summary or llm_summarize(sections)
    if not summary:
        push("调用分析agent大模型中（最终整理）", "error", detail="LLM 生成失败")
        push("生成结果中", "error", detail="LLM 生成失败")
        raise HTTPException(502, "LLM 生成失败：未启用或模型不可用，请检查 .env 的 OPENAI_* 或 LLM_*。")

    push("调用分析agent大模型中（最终整理）", "done")

    push("生成结果中", "start")
    summary_one = one_liner(summary, max_len=120)
    push("生成结果中", "done", detail=summary_one or summary)

    return AnalyzeResp(
        indicator_card=indicator_card,
        resolved={
            "company": comp_row.get("display_name"),
            "metric": canon_metric,
            "year": year,
            "quarter": f"Q{quarter_int}",
            "modes": [m.value for m in req.modes]
        },
        sections=sections,
        summary=summary,
        progress=progress
    )

class BizFormula(BaseModel):
    metric_name: str
    description: Optional[str] = None
    variables: Optional[List[str]] = None
    compute: Optional[str] = None
    # 👇 新增
    method: Optional[str] = None
    method_name: Optional[str] = None
    compute_cn: Optional[str] = None
    variables_cn: Optional[List[str]] = None


app = FastAPI(title="deepanalysis_agent", version="0.3.1")
# deepanalysis_agent.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,   # 允许含凭证请求
)

ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}

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
        # 把 500 包成 JSON，方便前端看到真实错误
        resp = JSONResponse({"detail": str(e)}, status_code=500)
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp
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

def require_token(authorization: Optional[str] = Header(None)):
    if DEV_BYPASS_AUTH: return True
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Unauthorized")
    return True

@app.get("/business/formulas", response_model=List[BizFormula])
def list_business_formulas(_:bool=True):
    _reload_caches()
    out: List[BizFormula] = []
    method_label = {"dupont": "杜邦分解", "ratio": "公式法"}

    for f in _FORMULAS:
        if f.get("formula_label") != "业务公式" or not f.get("enabled", True):
            continue

        pf = _parse_formula(f)  # 返回 {expr,var_keys,var_cn_map}，但 expr 可能是第一条
        comp_raw = f.get("compute")
        expr = ""
        if isinstance(comp_raw, dict):
            # ✅ 优先取最终目标
            if "roe" in comp_raw: expr = comp_raw["roe"]
            elif "result" in comp_raw: expr = comp_raw["result"]
            elif "value" in comp_raw: expr = comp_raw["value"]
            else:
                # 没有显式键时取“最后一条”
                try:
                    last_key = list(comp_raw.keys())[-1]
                    expr = comp_raw[last_key]
                except Exception:
                    expr = ""
        elif isinstance(comp_raw, str):
            expr = comp_raw

        # 变量映射（中文）
        cn_map = dict(pf.get("var_cn_map") or {})
        # 杜邦常见缩写补全
        if (f.get("method") or "").lower() == "dupont":
            cn_map.update({"npm": "净利率", "at": "总资产周转率", "em": "权益乘数", "roe": "ROE"})

        compute_cn = expr_to_cn(expr, cn_map)
        method = (f.get("method") or "").lower()
        out.append(BizFormula(
            metric_name=f.get("metric_name"),
            description=f.get("description"),
            variables=list(cn_map.values()) or None,
            variables_cn=list(cn_map.values()) or None,
            compute=expr,
            compute_cn=compute_cn,
            method=method,
            method_name=method_label.get(method, f.get("method") or "业务公式"),
        ))
    return out


def _drill_anomaly(company_row: Dict[str, Any], year: int, quarter_int: int, top_k: int) -> Dict[str, Any]:
    rows = list_company_metrics_by_name(company_row.get("display_name"), year, quarter_int)
    table = []
    for r in rows:
        cur = r.get("metric_value"); yoyb = r.get("last_year_value"); qoqb = r.get("last_period_value")
        yoy = None if (cur is None or yoyb is None) else cur - yoyb
        qoq = None if (cur is None or qoqb is None) else cur - qoqb
        table.append({"metric": r.get("metric_name"),
                      "current": cur, "yoy_change": yoy, "qoq_change": qoq,
                      "current_str": fmt_num(cur), "yoy_change_str": fmt_num(yoy), "qoq_change_str": fmt_num(qoq)})
    def key_yoy(x): v = x.get("yoy_change"); return abs(v) if isinstance(v,(int,float)) else -1
    def key_qoq(x): v = x.get("qoq_change"); return abs(v) if isinstance(v,(int,float)) else -1
    top_yoy = sorted(table, key=key_yoy, reverse=True)[:max(1, top_k)]
    top_qoq = sorted(table, key=key_qoq, reverse=True)[:max(1, top_k)]
    return {"type":"anomaly","title":f"异动分析（TOP{top_k}）","top_yoy":top_yoy,"top_qoq":top_qoq}

@app.post("/deepanalysis/analyze", response_model=AnalyzeResp)
def analyze(req: AnalyzeReq, _=Depends(require_token)):
    # 同步版：收集进度后一次性返回（与你原有行为一致）
    return _analyze_core(req, on_push=None)

# === 新增：SSE 流式接口 ===
@app.post("/deepanalysis/analyze/stream")
# deepanalysis_agent.py -> analyze_stream()
async def analyze_stream(req: AnalyzeReq, _=Depends(require_token)):
    async def event_gen():
        q: asyncio.Queue = asyncio.Queue()

        def on_push(ev: Dict[str, Any]):
            try: q.put_nowait(("progress", ev))
            except Exception: pass

        task = asyncio.create_task(asyncio.to_thread(_analyze_core, req, on_push))

        while True:
            if task.done():
                # ← 在真正发送最终结果之前，等至少 THOUGHT_DELAY_MS
                await asyncio.sleep(max(THOUGHT_DELAY_MS, 500)/1000.0)
                try:
                    resp: AnalyzeResp = task.result()
                    payload = json.dumps(resp.dict(), ensure_ascii=False)
                    yield f"event: done\ndata:{payload}\n\n"
                except Exception as e:
                    yield f"event: done\ndata:{json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
                break

            try:
                typ, ev = await asyncio.wait_for(q.get(), timeout=0.1)
                yield f"event: {typ}\ndata:{json.dumps(ev, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                continue


    return StreamingResponse(event_gen(), media_type="text/event-stream")




if __name__ == "__main__":
    import uvicorn
    uvicorn.run("deepanalysis_agent:app", host="0.0.0.0", port=18030, reload=False)
