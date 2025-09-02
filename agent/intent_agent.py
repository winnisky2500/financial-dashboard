# -*- coding: utf-8 -*-
"""
intent_agent.py
规则：如果 UI 选中【分析下钻】Tab（或显式 force_deep=true），无条件走 deepanalysis_agent；
否则再按问数/分析/政策/其他做识别与路由。
依赖：fastapi, uvicorn, requests, pydantic, python-dotenv
建议端口：18040
"""
from __future__ import annotations

import os, re, json
from typing import Any, Dict, List, Optional, Tuple
from enum import Enum

import requests
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv, find_dotenv
from dotenv import load_dotenv, find_dotenv
p = find_dotenv(".env.backend", raise_error_if_not_found=False)
if p: load_dotenv(p, override=True)

# 开发期直通（前端传不传 token 都能用）
DEV_BYPASS_AUTH = (os.getenv("DEV_BYPASS_AUTH") or "true").lower() == "true"

def _get_env(keys, default=None):
    for k in keys:
        v = os.getenv(k)
        if v:
            return v
    return default

# LLM（兼容 OPEN_API_BASE）
LLM_BASE  = _get_env(
    ["OPENAI_BASE_URL","OPENAI_API_BASE","OPEN_API_BASE","LLM_BASE_URL","LLM_BASE"],
    "https://api.openai.com/v1"
)
LLM_KEY   = _get_env(["OPENAI_API_KEY","OPEN_API_KEY","LLM_API_KEY"])
LLM_MODEL = _get_env(["OPENAI_MODEL","LLM_MODEL"], "gpt-4o")

# 下游服务地址/令牌（给 auto_execute 用）
DATA_AGENT_BASE_URL = _get_env(["DATA_AGENT_BASE_URL","DATA_API"], "http://127.0.0.1:18010")
DEEP_AGENT_BASE_URL = _get_env(["DEEP_AGENT_BASE_URL","DEEP_API"], "http://127.0.0.1:18030")
DATA_AGENT_TOKEN    = _get_env(["DATA_AGENT_TOKEN","ROE_AGENT_TOKEN"], "")
DEEP_AGENT_TOKEN    = _get_env(["DEEP_AGENT_TOKEN","ROE_AGENT_TOKEN"], "")

DOWNSTREAM_TIMEOUT  = int(_get_env(["DEEP_AGENT_TIMEOUT","DOWNSTREAM_TIMEOUT","INTENT_DOWNSTREAM_TIMEOUT"], "180"))
# ====== Schema ======
class Intent(str, Enum):
    dataquery = "dataquery"   # 问数
    deep      = "deep"        # 分析下钻
    policy    = "policy"      # 政策影响
    other     = "other"       # 其他

class RouteReq(BaseModel):
    question: str
    # 可选的结构化信息（有就转发给下游）
    business_formula_metric_name: Optional[str] = None
    company: Optional[str] = None
    metric: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[str] = None  # "Q1".."Q4" or "1".."4"

    # ===== UI 强制路由相关 =====
    ui_tab: Optional[str] = Field(default=None, description="当前激活 Tab，如 'analysis'")
    force_deep: bool = False
    selected_modes: Optional[List[str]] = None   # ← 保留这一处

    # ===== 非 UI 场景下的后备参数 =====
    modes: Optional[List[str]] = Field(default=None, description="后备：未提供 selected_modes 时可用")

    policy_title: Optional[str] = None
    auto_execute: bool = True


class RouteResp(BaseModel):
    intent: Intent
    confidence: float
    reason: str
    target_agent: Optional[str] = None
    auto_executed: bool = False
    routed_payload: Optional[Dict[str, Any]] = None
    routed_response: Optional[Dict[str, Any]] = None


# ====== App & Auth ======
app = FastAPI(title="intent_agent", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_origin_regex=".*",
    allow_methods=["*"], allow_headers=["*"],
    expose_headers=["*"],
    allow_credentials=False,   # ★ 关键：与 "*" 不能同时为 True
    max_age=86400,
)

def require_token(authorization: Optional[str] = Header(None)):
    if DEV_BYPASS_AUTH:
        return True
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True


PROMPT_INTENT = (
  "你是企业财务问答的意图区分器。请阅读用户问题，返回 JSON："
  '{"intent":"dataquery|deep|policy|other","modes":["dimension","metric","business","anomaly"],'
  '"confidence":0.0~1.0,"reason":"中文简述"}'
  " 说明："
  " - dataquery=取数/是多少/查询值；deep=分析/下钻/归因/为什么/同比/环比；policy=政策影响；"
  " - modes 只在 intent=deep 才填写，未提及时可根据问题推测；"
  " - 只返回 JSON，不要其他文本。"
)

def llm_classify_intent(question: str) -> Optional[Dict[str, Any]]:
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        return None
    try:
        content = call_llm_chat(system="意图识别", user=f"{PROMPT_INTENT}\n\nQ:{question}", temperature=0.1)
        data = json.loads(content)
        if not isinstance(data, dict): return None
        return data
    except Exception:
        return None

# ====== 关键词（启发式仅用于非强制场景） ======
ASK_WORDS = ["多少", "是多少", "查一下", "查询", "看一下", "给我", "取数", "数值", "值", "数据", "展示", "统计"]
ANALYZE_WORDS = ["分析", "变动原因", "原因", "为什么", "归因", "下钻", "拆解", "贡献度", "同比", "环比", "谁引起", "哪个子公司", "哪个指标", "分解", "归因分析"]
POLICY_WORDS = ["政策", "新政", "新规", "央行", "发改委", "财政部", "监管", "降息", "化债", "房地产政策", "汇率政策", "关税", "补贴", "红头文件", "通知", "指导意见"]
DEEP_MODE_WORDS = {
    "dimension": ["维度", "子公司", "板块", "下级公司", "分公司"],
    "metric":    ["指标下钻", "标准公式", "杜邦", "拆分指标", "公式法"],
    "business":  ["业务下钻", "业务公式", "业务分解"],
    "anomaly":   ["异动", "波动最大", "top", "排行", "剧烈变化"]
}

def norm(s: str) -> str:
    import re
    return re.sub(r"\s+", "", s.lower())


def heuristic_intent(q: str) -> Tuple[Intent, float, str]:
    qs = norm(q)
    if any(w in qs for w in POLICY_WORDS):
        return Intent.policy, 0.9, "命中政策类关键词"
    hit_analyze = any(w in qs for w in ANALYZE_WORDS)
    hit_ask     = any(w in qs for w in ASK_WORDS)
    if hit_analyze and not hit_ask:
        return Intent.deep, 0.8, "命中分析/归因类关键词"
    if hit_ask and not hit_analyze:
        return Intent.dataquery, 0.8, "命中问数/查询类关键词"
    if hit_analyze and hit_ask:
        return Intent.deep, 0.65, "同时命中问数与分析，优先路由到分析"
    return Intent.other, 0.5, "未命中明确关键词，暂归为其他"


def guess_deep_modes(q: str) -> List[str]:
    qs = norm(q)
    modes = []
    for k, ws in DEEP_MODE_WORDS.items():
        if any(w in qs for w in ws):
            modes.append(k)
    return modes or ["metric", "anomaly"]


# ====== LLM（可选：用于政策分析 & 低置信分类，保持最简实现） ======
def call_llm_chat(system: str, user: str, temperature: float = 0.2, timeout: int = 45) -> str:
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        raise RuntimeError("LLM 未配置")

    # 1) 模型决定端点
    endpoint = "/responses" if str(LLM_MODEL).startswith(("gpt-5", "o4", "o3")) else "/chat/completions"
    url = f"{LLM_BASE.rstrip('/')}{endpoint}"

    # 2) 组装 payload
    if endpoint == "/responses":
        payload = {
            "model": LLM_MODEL,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": system}]},
                {"role": "user",   "content": [{"type": "input_text", "text": user}]}
            ]
        }
    else:
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user}
            ],
            "temperature": temperature
        }

    r = requests.post(url,
        headers={"Authorization": f"Bearer {LLM_KEY}", "Content-Type": "application/json"},
        json=payload, timeout=timeout
    )
    r.raise_for_status()
    data = r.json()

    # 统一抽取
    if endpoint == "/responses":
        if isinstance(data, dict) and "output_text" in data:
            return data["output_text"]
        out = (data.get("output") or [])
        if out and isinstance(out[0], dict):
            parts = out[0].get("content", [])
            texts = [p.get("text") for p in parts if isinstance(p, dict) and p.get("text")]
            if texts:
                return "\n".join(texts)
        # 回退：如果 responses 仍然空，尝试一次 chat/completions
        url2 = f"{LLM_BASE.rstrip('/')}/chat/completions"
        r2 = requests.post(url2,
            headers={"Authorization": f"Bearer {LLM_KEY}", "Content-Type": "application/json"},
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role":"system","content": system},
                    {"role":"user","content": user}
                ],
                "temperature": temperature
            }, timeout=timeout
        )
        r2.raise_for_status()
        d2 = r2.json()
        return d2["choices"][0]["message"]["content"]
    else:
        return data["choices"][0]["message"]["content"]




# ====== 下游调用 ======
def call_dataquery(payload: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.post(
        f"{DATA_AGENT_BASE_URL}/metrics/query",
        headers={"Authorization": f"Bearer {DATA_AGENT_TOKEN}", "Content-Type":"application/json"},
        json=payload, timeout=30
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"dataquery_agent 调用失败: {r.text}")
    return r.json()

def call_deepanalysis(payload: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.post(
        f"{DEEP_AGENT_BASE_URL}/deepanalysis/analyze",
        headers={"Authorization": f"Bearer {DEEP_AGENT_TOKEN}", "Content-Type":"application/json"},
        json=payload, timeout=DOWNSTREAM_TIMEOUT   # ← 用上面的可配置超时
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"deepanalysis_agent 调用失败: {r.text}")
    return r.json()
def call_policy_llm(question: str, policy_title: Optional[str]) -> Dict[str, Any]:
    try:
        content = call_llm_chat(
            system=("你是资深财务分析师。请对给定政策问题进行影响分析，输出结构："
                    "1) 结论要点(≤3)，2) 影响路径(利润/现金流/资产负债/合规)，3) 量化口径与数据建议，4) 后续动作建议(≤3)。"
                    "要求中文、短句、可执行。"),
            user=policy_title or question,
            temperature=0.2
        )
        return {"policy_title": policy_title, "question": question, "analysis": content}
    except Exception as e:
        return {"message": f"政策影响分析失败或未配置模型：{e}", "policy_title": policy_title, "question": question}


# ====== 路由入口 ======
@app.post("/intent/route", response_model=RouteResp)
def route(req: RouteReq, _=Depends(require_token)):

    # ========== 0) UI 强制走 deepanalysis ==========
    ui_is_analysis = (req.ui_tab or "").strip().lower() in {"analysis", "deep", "下钻", "分析下钻"}
    if req.force_deep or ui_is_analysis:
        modes = req.selected_modes or req.modes or []
        if not modes:
            modes = guess_deep_modes(req.question)

        # 互斥校验（前端若传了冲突，直接在这里报错，避免 deep agent 再 400）
        if ("metric" in modes) and ("business" in modes):
            raise HTTPException(status_code=400, detail="『指标下钻』与『业务下钻』不能同时选择，请二选一。")

        payload = {
            "question": req.question,
            "company": req.company,
            "metric": req.metric,
            "year": req.year,
            "quarter": req.quarter,
            "modes": modes,
            "business_formula_metric_name": req.business_formula_metric_name,
        }

        routed_resp = call_deepanalysis(payload) if req.auto_execute else None

        return RouteResp(
            intent=Intent.deep,
            confidence=0.99,
            reason="UI：分析下钻 Tab 已选，强制路由到 deepanalysis。",
            target_agent="deepanalysis_agent",
            auto_executed=bool(req.auto_execute),
            routed_payload=payload,
            routed_response=routed_resp
        )

    # ========== 1) 非强制：优先用 LLM ==========
    modes: List[str] = []
    llm = llm_classify_intent(req.question)
    if llm:
        try:
            intent = Intent(llm.get("intent", "other"))
        except Exception:
            intent = Intent.other
        conf = float(llm.get("confidence", 0.6))
        reason = llm.get("reason", "LLM 分类")
        modes = llm.get("modes") or []
    else:
        intent, conf, reason = heuristic_intent(req.question)
        modes = []

    # 下面路由 deep 时，优先使用 LLM 给出的 modes


    # ========== 2) 组装路由 ==========
    payload: Dict[str, Any] = {}
    target_agent: Optional[str] = None

    if intent == Intent.dataquery:
        target_agent = "dataquery_agent"
        payload = {
            "question": req.question,
            "company": req.company, "metric": req.metric,
            "year": req.year, "quarter": req.quarter,
            "scenario": "actual"
        }
    elif intent == Intent.deep:
        target_agent = "deepanalysis_agent"
        modes = modes or req.modes or guess_deep_modes(req.question)
        if ("metric" in modes) and ("business" in modes):
            raise HTTPException(status_code=400, detail="『指标下钻』与『业务下钻』不能同时选择，请二选一。")
        payload = {
            "question": req.question,
            "company": req.company, "metric": req.metric,
            "year": req.year, "quarter": req.quarter,
            "modes": modes,
            "business_formula_metric_name": req.business_formula_metric_name,
        }


    elif intent == Intent.policy:
        target_agent = "policy_llm"
        payload = {"question": req.question, "policy_title": req.policy_title}
    else:
        target_agent = None
        payload = {}

    # ========== 3) 自动执行 ==========
    routed_resp: Optional[Dict[str, Any]] = None
    auto_executed = False
    if req.auto_execute:
        if intent == Intent.dataquery:
            routed_resp = call_dataquery(payload); auto_executed = True
        elif intent == Intent.deep:
            routed_resp = call_deepanalysis(payload); auto_executed = True
        elif intent == Intent.policy:
            routed_resp = call_policy_llm(**payload); auto_executed = True
        else:
            routed_resp = {"message": "这似乎不是财务问题。请询问具体公司/指标/期间，或在首页从政策标题进入查看影响。"}
            auto_executed = True

    return RouteResp(
        intent=intent, confidence=conf, reason=reason,
        target_agent=target_agent, auto_executed=auto_executed,
        routed_payload=payload, routed_response=routed_resp
    )


# ====== 本地调试 ======
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("intent_agent:app", host="0.0.0.0", port=18040, reload=False)
