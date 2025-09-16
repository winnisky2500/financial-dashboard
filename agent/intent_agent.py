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
# intent_agent.py 顶部
import asyncio
import httpx  # 需要: pip install httpx

# intent_agent.py
from fastapi.responses import StreamingResponse
# === 添加在 intent_agent.py 顶部或合适位置 ===
from pydantic import BaseModel, Field, validator
from typing import List, Literal, Optional, Dict, Any
import json, os, datetime
from datetime import datetime  






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
THOUGHT_DELAY_MS = int(_get_env(["THOUGHT_DELAY_MS"], "600"))
GOOGLE_API_KEY = _get_env(["GOOGLE_API_KEY", "CSE_API_KEY"])
GOOGLE_CSE_ID  = _get_env(["GOOGLE_CSE_ID",  "CSE_ID"])
# 对话上下文轮数（默认3，可通过环境变量 DIALOG_CONTEXT_ROUNDS 调整）
DIALOG_CONTEXT_MAX_ROUNDS = int(os.getenv("DIALOG_CONTEXT_ROUNDS", "3") or "3")
# ======= Supabase（为 LLM 解析提供公司/指标目录与“最新期”提示）=======
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def _sb(path: str, params: Dict[str, Any]) -> Any:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise RuntimeError("Supabase 未配置")
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path.lstrip('/')}"
    r = requests.get(
        url, params=params, timeout=20,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    r.raise_for_status()
    return r.json()

def _sb_safe(path: str, params: Dict[str, Any]) -> Any:
    try:
        return _sb(path, params)
    except Exception:
        return []

def _to_alias_list(als) -> List[str]:
    if als is None:
        return []
    if isinstance(als, list):
        return [str(x).strip() for x in als if x is not None and str(x).strip()]
    if isinstance(als, str):
        s = als.strip()
        try:
            if (s.startswith("[") and s.endswith("]")) or (s.startswith("{") and s.endswith("}")):
                j = json.loads(s.replace("{", "[").replace("}", "]"))
                if isinstance(j, list):
                    return [str(x).strip() for x in j if x is not None and str(x).strip()]
        except Exception:
            pass
        import re as _re
        s2 = s.strip("{}")
        parts = _re.split(r'[,\|/;；，、\s]+', s2)
        return [p.strip().strip('"').strip("'") for p in parts if p.strip()]
    return []

# 仅为构造 LLM 输入使用的轻量目录
def _catalog_payload_for_llm() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    rows_c = _sb_safe("company_catalog", {"select": "display_name,aliases"})
    companies = []
    seen = set()
    for r in rows_c:
        name = r.get("display_name")
        if not name or name in seen:
            continue
        seen.add(name)
        companies.append({"display_name": name, "aliases": _to_alias_list(r.get("aliases"))})

    rows_m = _sb_safe("metric_alias_catalog", {"select": "canonical_name,aliases"})
    metrics = []
    for r in rows_m:
        cn = r.get("canonical_name")
        if not cn:
            continue
        metrics.append({"canonical_name": cn, "aliases": _to_alias_list(r.get("aliases"))})
    return companies, metrics

def _latest_period_any() -> Optional[Dict[str, int]]:
    rows = _sb_safe("financial_metrics", {"select": "year,quarter", "order": "year.desc,quarter.desc", "limit": "1"})
    if rows:
        try:
            return {"year": int(rows[0]["year"]), "quarter": int(rows[0]["quarter"])}
        except Exception:
            return None
    return None

# ====== Schema ======
class Intent(str, Enum):
    dataquery = "dataquery"   # 问数
    deep      = "deep"        # 分析下钻
    policy    = "policy"      # 政策影响
    other     = "other"       # 其他

class RouteReq(BaseModel):
    question: str
    business_formula_metric_name: Optional[str] = None
    company: Optional[str] = None
    metric: Optional[str] = None
    year: Optional[int] = None
    quarter: Optional[str] = None  # "Q1".."Q4" or "1".."4"

    # ===== UI 强制路由相关 =====
    ui_tab: Optional[str] = Field(default=None, description="当前激活 Tab，如 'analysis'")
    force_deep: bool = False
    selected_modes: Optional[List[str]] = None

    # ===== 非 UI 场景下的后备参数 =====
    modes: Optional[List[str]] = Field(default=None, description="后备：未提供 selected_modes 时可用")

    # orchestration 开关（当前未在后端使用，但先接受前端入参，便于后续扩展）
    orchestrate: Optional[bool] = False

    policy_title: Optional[str] = None
    auto_execute: bool = True

    # ===== 新增：多轮上下文（最近N轮） =====
    # 形如：{"turns":[{"role":"user","content":"..."},
    #                {"role":"assistant","content":"..."}], "max_rounds":3}
    dialog_context: Optional[Dict[str, Any]] = None




class RouteResp(BaseModel):
    intent: Intent
    confidence: float
    reason: str
    target_agent: Optional[str] = None
    auto_executed: bool = False
    routed_payload: Optional[Dict[str, Any]] = None
    routed_response: Optional[Dict[str, Any]] = None

class PlanTask(BaseModel):
    agent: Literal["deepanalysis_agent", "dataquery_agent"]
    params: Dict[str, Any] = Field(..., description="参数必须可直接传给对应agent")

class PlanOutput(BaseModel):
    reason: Optional[str] = None
    tasks: List[PlanTask]
    aggregation_hints: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None

    @validator("tasks")
    def _not_empty(cls, v):
        if not v:
            raise ValueError("tasks 不能为空")
        return v
    
INTENT_CN = {"dataquery":"取数","deep":"下钻分析","policy":"政策","other":"其他"}
MODE_CN   = {"dimension":"维度下钻","metric":"指标下钻","business":"业务下钻","anomaly":"异动分析"}
to_cn_intent = lambda x: INTENT_CN.get(x, x)
to_cn_modes  = lambda ms: "、".join(MODE_CN.get(m, m) for m in (ms or []))

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

# intent_agent.py 任意工具函数区
async def _proxy_deep_stream(client: httpx.AsyncClient, url: str, headers: dict, payload: dict):
    """
    把 deepanalysis 的 SSE 事件转发出去：
    - progress: 不再透传（避免同层乱序）
    - done: 截获其数据，返回给上层，由上层决定何时发最终 done
    - 发生下游错误/返回非SSE/连接异常时，统一封装为 done 错误，避免浏览器抛 network error
    """
    final_payload = None
    try:
        async with client.stream("POST", url, headers=headers, json=payload, timeout=None) as r:
            # 1) 状态码兜底（转“结构化错误”而不是断流）
            if r.status_code >= 400:
                body = await r.aread()
                msg = body.decode("utf-8", "ignore")
                err = json.dumps({"error": f"deepanalysis_agent HTTP {r.status_code}", "detail": msg}, ensure_ascii=False)
                yield ("done", err)
                return

            # 2) Content-Type 必须是 SSE
            ctype = (r.headers.get("content-type") or "").lower()
            if "text/event-stream" not in ctype:
                body = await r.aread()
                msg = body.decode("utf-8", "ignore")
                err = json.dumps({"error": "deepanalysis_agent 未返回SSE", "detail": msg}, ensure_ascii=False)
                yield ("done", err)
                return

            # 3) 正常解析 SSE
            event, data_buf = None, []
            async for line in r.aiter_lines():
                if not line:
                    if event and data_buf:
                        data = "\n".join([x[5:] for x in data_buf if x.startswith("data:")]).strip()
                        if event == "progress":
                            # 不透传子层进度，避免乱序
                            pass
                        elif event == "done":
                            final_payload = data
                            break
                    event, data_buf = None, []
                    continue
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data_buf.append(line)

        if final_payload is not None:
            yield ("done", final_payload)
    except Exception as e:
        err = json.dumps({"error": f"deepanalysis_agent 流式失败：{e}"}, ensure_ascii=False)
        yield ("done", err)
    return


@app.post("/intent/route/stream")
async def route_stream(req: RouteReq, _=Depends(require_token), authorization: Optional[str] = Header(None)):
    incoming_auth = authorization  # 供上面的 down_token 复用

    async def gen():
        seq = 0
        def send_progress(step: str, status: str, group: Optional[str] = None, detail: Optional[str] = None) -> str:
            nonlocal seq
            seq += 1
            payload = {"step": step, "status": status, "seq": seq}
            if group:  payload["group"]  = group
            if detail: payload["detail"] = detail
            return f"event: progress\ndata:{json.dumps(payload, ensure_ascii=False)}\n\n"
        def _build_clarify(company, metric, year, quarter, periods):
            lack = []
            if not company: lack.append("公司")
            if not metric: lack.append("指标")
            # 没有显式期次也没有 period 列表时，要求补时间
            if not (year and quarter) and not (periods or []):
                lack.append("时间（年份+季度）")
            if not lack:
                return None
            return "你好，你的问题可能不是一个财务问题或缺少关键信息，请补充：" + "、".join(lack) + "。例如：2025 年 Q1。"

        # 1) 起手：意图识别（统一走 send_progress，保证 seq 递增）
        yield send_progress("意图识别中", "start", group="意图")
        thought = await asyncio.to_thread(gen_stream_thought, "意图识别", req.question, None, None)
        yield send_progress("思考·意图识别", "doing", group="意图", detail=thought)

        intent = None
        modes: List[str] = []
        ui_tab_str = str(req.ui_tab or "").lower()
        force_deep_by_ui = req.force_deep or (ui_tab_str in {"analysis", "deep", "drill", "下钻", "分析下钻"})

        has_modes = bool(req.selected_modes or req.modes or force_deep_by_ui)
        llm_intent_obj = None
        if has_modes:
            intent = "deep"
            modes = req.selected_modes or req.modes or ["dimension"]
        else:
            llm_intent_obj = await asyncio.to_thread(
                llm_classify_intent, req.question, (req.dialog_context or {}).get("turns")
            )

            if llm_intent_obj:
                intent = (llm_intent_obj.get("intent") or "other").lower()
                modes  = llm_intent_obj.get("modes") or []
            else:
                intent = "dataquery"; modes = []

        # —— 新增：基于已识别的意图再给一次明确话术
        thought2 = await asyncio.to_thread(gen_stream_thought, "意图识别", req.question, intent, modes)
        yield send_progress("思考·意图识别", "doing", group="意图", detail=thought2)

        tag = to_cn_modes(modes) if (intent == "deep") else to_cn_intent(intent)
        yield send_progress("意图识别结果", "done", group="意图", detail=tag)
        yield send_progress("思考·意图识别", "done", group="意图")
        yield send_progress("意图识别中", "done", group="意图")

        # —— 非财务/不相关：就地收尾并给出指引
        if intent == "other":
            msg = ("这似乎不是财务/数据分析问题。\n"
                "• 如需分析政策影响：请从【政策】入口或直接提供具体政策标题。\n"
                "• 如需财务问数/分析：请提供公司、指标与时间（例如：2025 年 Q1 XX集团的营业收入）。")
            final_merged = {
                "need_clarification": True,
                "ask": "请明确是做『政策影响分析』还是『财务问数/下钻』，并补充公司/指标/时间。",
                "message": msg,
                "resolved": {"company": None, "metric": None, "periods": []},
                "cards": [], "sections": [], "summary": "", "progress": []
            }
            yield f"event: done\ndata:{json.dumps(final_merged, ensure_ascii=False)}\n\n"
            return


        # 2) 槽位抽取（即使是 UI 强制下钻也抽）
        slots = await asyncio.to_thread(
            llm_extract_slots, req.question, (req.dialog_context or {}).get("turns")
        )

        def pick(*vals):
            for v in vals:
                if v not in (None, "", []):
                    return v
            return None
        company = pick(req.company,  slots.get("company"))
        metric  = pick(req.metric,   slots.get("metric"))
        periods = slots.get("periods") or []
        year    = pick(req.year,    (periods[0]["year"] if periods else None))
        quarter = pick(req.quarter, (periods[0]["quarter"] if periods else None))
        quarter = _norm_quarter(quarter)

        # 阶段话术 & 编排开始
        plan_thought = await asyncio.to_thread(gen_stream_thought, "计划", req.question, intent, modes)
        yield send_progress("编排中", "start", group="编排")
        # 在编排组内记录思考文本
        yield send_progress("思考·执行计划", "doing", group="编排", detail=plan_thought)
        yield send_progress("思考·执行计划", "done", group="编排")
        # ★ 收尾“编排中(done)”，前端按序打勾
        yield send_progress("编排中", "done", group="编排")

        # 互斥校验
        if intent == "deep" and ("metric" in modes) and ("business" in modes):
            err = "『指标下钻』与『业务下钻』不能同时选择，请二选一。"
            yield f"event: done\ndata:{json.dumps({'error':err},ensure_ascii=False)}\n\n"
            return

        # 3) 根据意图路由
        if intent == "dataquery":
            # ===== ① 多轮补齐槽位：从“上几轮用户话语”里继承缺失的公司/指标/期间 =====
            prev_turns = (req.dialog_context or {}).get("turns") or []
            prev_user_msgs = [(t.get("content") or "").strip() for t in prev_turns if (t.get("role") == "user")]
            prev_company = prev_metric = None
            prev_year = None; prev_quarter = None
            for utxt in reversed(prev_user_msgs):
                if not utxt:
                    continue
                try:
                    prev = await asyncio.to_thread(llm_extract_slots, utxt)
                except Exception:
                    prev = {}
                if prev and isinstance(prev, dict):
                    prev_company = prev_company or prev.get("company")
                    prev_metric  = prev_metric  or prev.get("metric")
                    if (not year or not quarter) and (prev.get("periods") or []):
                        try:
                            pyq = prev["periods"][0]
                            if not prev_year:    prev_year = int(pyq.get("year"))
                            if not prev_quarter: prev_quarter = _norm_quarter(pyq.get("quarter"))
                        except Exception:
                            pass
                # 已经都补齐则提前退出
                if (company or prev_company) and (metric or prev_metric) and ((year and quarter) or (prev_year and prev_quarter)):
                    break

            company = company or prev_company
            metric  = metric  or prev_metric
            year    = year    or prev_year
            quarter = _norm_quarter(quarter or prev_quarter)

            # ===== ② 任务生成：不再调用 LLM 编排，避免“幻觉公司名” =====
            period_list = (slots.get("periods") or [])
            tasks = []
            if period_list:
                for p in period_list[:8]:
                    try:
                        yy = int(p.get("year"))
                        qq = _norm_quarter(p.get("quarter"))
                        tasks.append({"agent": "dataquery_agent",
                                    "params": {"company": company, "metric": metric, "year": yy, "quarter": qq}})
                    except Exception:
                        continue
            else:
                tasks = [{"agent":"dataquery_agent","params":{
                    "company": company, "metric": metric, "year": year, "quarter": quarter
                }}]

            yield send_progress("编排完成", "done", group="编排", detail=f"{len(tasks)} 个取数子任务")

            # ===== ③ 执行 dataquery，带超时/失败收尾，不让前端一直转圈 =====
            cards, period_labels = [], []
            for i, t in enumerate(tasks, 1):
                p = t.get("params") or {}
                comp = p.get("company") or company
                metr = p.get("metric")  or metric
                y    = p.get("year")    or year
                q    = _norm_quarter(p.get("quarter") or quarter)
                label = f"{y}{q}" if y and q else ""
                if label:
                    period_labels.append(label)

                step_tip = f"正在读取 {comp or '-'} {y or '-'}{q or ''} 的 {metr or '-'} 数据"
                yield send_progress(step_tip, "start", group="执行")

                payload = {"question": req.question, "company": comp, "metric": metr, "year": y, "quarter": q, "scenario": "actual"}
                try:
                    data = await asyncio.to_thread(call_dataquery, payload)
                except Exception as e:
                    # 超时/网络/下游异常：立刻收尾并给出可执行提示
                    yield send_progress(step_tip, "done", group="执行", detail="失败/超时")
                    final_merged = {
                        "need_clarification": True,
                        "ask": "查询超时或数据源无响应。请确认：公司、指标、时间（如 2025 年 Q1），或稍后重试。",
                        "message": f"取数失败：{e}",
                        "resolved": {"company": comp, "metric": metr, "periods": [label] if label else []},
                        "cards": [], "sections": [], "summary": "", "progress": []
                    }
                    yield f"event: done\ndata:{json.dumps(final_merged, ensure_ascii=False)}\n\n"
                    return

                card = (data or {}).get("indicator_card")
                if card: cards.append(card)
                yield send_progress(step_tip, "done",  group="执行")

            # ===== ④ 聚合与总结 =====
            summary = ""
            try:
                summary = await asyncio.to_thread(llm_cards_summary, req.question, cards)
            except Exception:
                summary = ""

            # 新增：基于本轮上下文生成推荐追问
            try:
                sugs = await asyncio.to_thread(
                    llm_suggest_followups,
                    req.question,
                    company,
                    metric,
                    period_labels,
                    summary,
                    "dataquery"
                )
            except Exception:
                sugs = []

            final_merged = {
                "indicator_card": None,
                "resolved": {
                    "company": (plan.get("context") or {}).get("company") or company,
                    "metric":  (plan.get("context") or {}).get("metric")  or metric,
                    "multi_tasks": True,
                    "periods": [p for p in period_labels if p],
                    "modes": [],
                },
                "cards": cards,
                "sections": [],
                "summary": summary,
                "progress": [],
                "suggested_questions": sugs,  # ← 新增字段
            }
            yield send_progress("合并与总结", "done", group="合并")
            await asyncio.sleep(max(THOUGHT_DELAY_MS, 500)/1000.0)

            yield f"event: done\ndata:{json.dumps(final_merged, ensure_ascii=False)}\n\n"
            return


        elif intent == "deep":
            ask_msg = _build_clarify(company, metric, year, quarter, slots.get("periods"))
            if ask_msg:
                final_merged = {
                    "need_clarification": True,
                    "ask": ask_msg,
                    "resolved": {"company": company, "metric": metric, "periods": []},
                    "cards": [], "sections": [], "summary": "", "progress": []
                }
                yield f"event: done\ndata:{json.dumps(final_merged, ensure_ascii=False)}\n\n"
                return

            # 下面保持原有 deep 逻辑...

            plan = await asyncio.to_thread(llm_make_task_plan, req.question, company, metric, year, quarter, (req.selected_modes or req.modes))
            tasks = plan.get("tasks", []) if isinstance(plan, dict) else []
            want_cards   = bool((plan.get("aggregation_hints") or {}).get("want_cards", True))
            want_section = bool((plan.get("aggregation_hints") or {}).get("want_sections", True))

            if not tasks:
                # 兜底：把“各季度/时间范围”展开为 periods
                plan_json = await asyncio.to_thread(llm_make_multi_plan, req.question, company, metric, year, quarter)
                periods2 = (plan_json.get("periods") or [])
                # ⚠️ 不再截断为 [:1] —— 每期都建 deep 任务
                tasks = [{
                    "agent": "deepanalysis_agent",
                    "params": {
                        "question": req.question,
                        "company": plan_json.get("company") or company,
                        "metric":  plan_json.get("metric")  or metric,
                        "year":    p["year"],
                        "quarter": p["quarter"],
                        "modes":   (req.modes or guess_deep_modes(req.question))
                    }
                } for p in (periods2 or [{"year": year, "quarter": quarter}])]

            # === 统一强制：当 UI 处于下钻 or LLM 识别为 deep 时，保证“每个期次都存在 deep 任务” ===
            # 取所有期次（来自现有 tasks 或 slots）
            def _norm_q(q):
                return _norm_quarter(q) or q
            period_set = set()
            for t in (tasks or []):
                p = (t.get("params") or {})
                y, q = (p.get("year") or year), _norm_q(p.get("quarter") or quarter)
                if y and q: period_set.add((int(y), str(q)))
            # slots 里也补充（适配“某年各季度/近四个季度”等）
            for p in (slots.get("periods") or []):
                if p.get("year") and p.get("quarter"):
                    period_set.add((int(p["year"]), str(_norm_q(p["quarter"]))))

            if not period_set and year and quarter:
                period_set.add((int(year), str(_norm_q(quarter))))

            # 计算哪些期次没有 deep 任务
            def _is_deep(t): return (t.get("agent") == "deepanalysis_agent")
            deep_keys = set()
            for t in tasks:
                if _is_deep(t):
                    pp = t.get("params") or {}
                    y, q = pp.get("year"), _norm_q(pp.get("quarter"))
                    if y and q: deep_keys.add((int(y), str(q)))

            ui_modes = (req.modes or req.selected_modes or (["dimension"] if force_deep_by_ui else []))
            need_modes = (ui_modes or guess_deep_modes(req.question))

            # 为缺失的期次追加 deep 任务（保证“每期至少 1 个 deep”）
            missing = [pq for pq in sorted(period_set) if pq not in deep_keys]
            for (yy, qq) in missing:
                base = (plan.get("context") or {})
                tasks.append({
                    "agent": "deepanalysis_agent",
                    "params": {
                        "question": req.question,
                        "company": base.get("company") or company,
                        "metric":  base.get("metric")  or metric,
                        "year":    yy,
                        "quarter": qq,
                        "modes":   need_modes
                    }
                })

            yield send_progress("编排完成", "done", group="编排", detail=f"{len(tasks)} 个子任务")



            items, cards, flat_sections, period_labels = [], [], [], []
            async with httpx.AsyncClient() as client:
                # 先用前端传来的 Authorization，若没有再用环境变量；都没有就不带这个头
                def _bearer(h: str|None) -> str:
                    s = (h or "").strip()
                    return s if s.lower().startswith("bearer ") else (f"Bearer {s}" if s else "")

                # 读取来路 Authorization（加入 route_stream 的参数见下一段）
                down_token = _bearer(incoming_auth) or (_bearer(DEEP_AGENT_TOKEN))
                headers = {"Content-Type": "application/json"}
                if down_token: headers["Authorization"] = down_token

                deep_url = f"{DEEP_AGENT_BASE_URL.rstrip('/')}/deepanalysis/analyze/stream"

                context = (plan.get("context") or {})
                def pick2(*vals):
                    for v in vals:
                        if v not in (None, "", []): return v
                    return None

                ui_modes = (req.modes or req.selected_modes or (["dimension"] if force_deep_by_ui else []))
                if ui_modes:
                    has_deep = any(t.get("agent") == "deepanalysis_agent" for t in tasks)
                    if not has_deep:
                        base = (tasks[0].get("params") if tasks else {}) or {}
                        tasks.append({"agent":"deepanalysis_agent","params":{
                            "company": pick2(base.get("company"), context.get("company"), company),
                            "metric":  pick2(base.get("metric"),  context.get("metric"),  metric),
                            "year":    pick2(base.get("year"),    context.get("year"),    year),
                            "quarter": pick2(base.get("quarter"), context.get("quarter"), quarter),
                            "modes":   ui_modes
                        }})

                # 只保留 deepanalysis 任务
                tasks = [t for t in (tasks or []) if (t.get("agent") == "deepanalysis_agent")]

                # === 新增：把多种下钻模式拆分为多个子任务（每种模式单独跑一次） ===
                expanded_tasks = []
                for t in tasks:
                    params_t = t.get("params") or {}
                    # 优先采用 UI 选择；其次用任务自身；最后兜底为 ["dimension"]
                    modes_this = (req.selected_modes or req.modes or params_t.get("modes") or ["dimension"])
                    modes_this = [m for m in modes_this if m]
                    for m in modes_this:
                        expanded_tasks.append({
                            "agent": "deepanalysis_agent",
                            "params": {**params_t, "modes": [m]}
                        })
                tasks = expanded_tasks

                # === 新增：逐期聚合容器（保留每个模式的“完整长总结”）与指标卡去重 ===
                period_to_mode_summaries: Dict[str, List[Tuple[str, str]]] = {}
                added_card_labels: set = set()

                for i, t in enumerate(tasks, 1):
                    params = t.get("params") or {}
                    y = params.get("year") or year
                    q = _norm_quarter(params.get("quarter") or quarter)
                    comp = params.get("company") or company
                    metr = params.get("metric")  or metric

                    # 本子任务仅包含一种模式
                    mode_list = params.get("modes") or (req.selected_modes or req.modes) or ["dimension"]
                    mode_one = (mode_list[0] if isinstance(mode_list, list) and mode_list else "dimension")
                    mode_cn  = MODE_CN.get(mode_one, mode_one)

                    label = f"{y}{q}" if y and q else ""
                    if label:
                        period_labels.append(label)

                    step_tip = f"子任务执行·下钻（{mode_cn}）：{comp or '-'} {y or '-'}{q or ''} 的 {metr or '-'}"
                    # 第一人称小字（传入当前模式，便于话术贴合）
                    sub_thought = await asyncio.to_thread(gen_stream_thought, "下钻执行", req.question, intent, [mode_one])
                    yield send_progress(step_tip, "start", group="执行", detail=sub_thought)

                    final_one = None
                    payload = {
                        "question": req.question,
                        "company": comp, "metric": metr, "year": y, "quarter": q,
                        "modes":   [mode_one],           # ← 每次只跑一种模式
                        "skip_policy": True
                    }

                    async for ev, data in _proxy_deep_stream(client, deep_url, headers, payload):
                        if ev == "progress":
                            # 仍透传子层进度（与上层 start/done 互补）
                            yield f"event: progress\ndata:{data}\n\n"
                        elif ev == "done":
                            final_one = json.loads(data)

                    if isinstance(final_one, dict):
                        # 每个期次只保存一次指标卡（避免同一期多模式重复）
                        if label and (label not in added_card_labels) and final_one.get("indicator_card"):
                            cards.append(final_one["indicator_card"])
                            added_card_labels.add(label)

                        # 保留“完整长总结”（不做单句压缩），按期次聚合并标注模式名
                        if final_one.get("summary"):
                            period_to_mode_summaries.setdefault(label or "", []).append((mode_cn, final_one.get("summary")))

                        # sections 标题加上 [期次][模式] 双标签，便于前端区分
                        for s in (final_one.get("sections") or []):
                            s2 = dict(s)
                            ttitle = s2.get("title") or s2.get("type") or "分析"
                            if label:
                                s2["title"] = f"[{label}][{mode_cn}] {ttitle}"
                            else:
                                s2["title"] = f"[{mode_cn}] {ttitle}"
                            flat_sections.append(s2)

                    yield f"event: progress\ndata:{json.dumps({'step':step_tip,'status':'done'})}\n\n"

            # 单次政策检索（仅一次，取时间范围的起止期）
            
            try:
                if period_labels:
                    # 解析起止期
                    def _parse(p):
                        import re
                        m = re.match(r"^(\d{4})(Q[1-4])$", str(p))
                        if not m: return None, None
                        return int(m.group(1)), m.group(2)

                    start_y, start_q = _parse(sorted(period_labels)[0])
                    # 你也可以只跑起始期；如需扩大召回，可把 end 也跑一遍
                    # end_y,   end_q   = _parse(sorted(period_labels)[-1])

                    base_ctx = (plan.get("context") or {})
                    comp = base_ctx.get("company") or company
                    metr = base_ctx.get("metric")  or metric

                    if start_y and start_q:
                        run_policy_once_at_intent(send_progress, flat_sections, comp, metr, start_y, start_q)
            except Exception:
                # 政策检索的异常不阻断整体流程
                pass
            # —— 新增：行业/宏观增强（根据维度结果做一次新闻检索）
            try:
                base_ctx = (plan.get("context") or {})
                comp = base_ctx.get("company") or company
                metr = base_ctx.get("metric")  or metric
                # 用起始期作为检索标签；如需放大召回也可用最后一期
                def _parse(p):
                    import re
                    m = re.match(r"^(\d{4})(Q[1-4])$", str(p))
                    if not m: return None, None
                    return int(m.group(1)), m.group(2)
                if period_labels:
                    yy, qq = _parse(sorted(period_labels)[0])
                else:
                    yy, qq = (year, quarter)
                run_industry_or_macro_enrichment_at_intent(send_progress, flat_sections, comp, metr, yy, qq)
            except Exception:
                pass


            # ④ 聚合与总结
            # ① deep 的逐期摘要
            # ④ 聚合与总结
            # 把“每期·多模式”的长结合并为单条逐期摘要（保留全文，不做单句压缩）
            items = []
            for lbl, pairs in sorted(period_to_mode_summaries.items()):
                # 形如：【维度下钻】……（完整长文）
                parts = [f"【{m}】{txt}" for (m, txt) in pairs if txt]
                if parts:
                    items.append({"label": lbl, "summary": "\n\n".join(parts)})

            merge_thought = await asyncio.to_thread(gen_stream_thought, "合并与总结", req.question, intent, modes)
            yield send_progress("合并与总结", "start", group="合并", detail=merge_thought)

            period_summaries = [f"[{it.get('label','')}] {it.get('summary','')}".strip()
                                for it in items if it.get("summary")]

            # ② 综合整合：汇总卡片 + 各段下钻 + 逐期摘要，输出完整综合结论
            resolved_ctx = {
                "company": (plan.get("context") or {}).get("company") or company,
                "metric":  (plan.get("context") or {}).get("metric")  or metric,
                "multi_tasks": True,
                "periods": [p for p in period_labels if p],
                "modes": list(set(sum([t.get('params',{}).get('modes', []) for t in tasks if t.get('agent')=='deepanalysis_agent'], [])))
            }

            overall_summary = await asyncio.to_thread(
                llm_final_synthesis,
                resolved_ctx,
                cards,
                flat_sections,
                [s for s in period_summaries if s]
            )

            # 新增：基于本轮上下文生成推荐追问
            try:
                sugs = await asyncio.to_thread(
                    llm_suggest_followups,
                    req.question,
                    resolved_ctx.get("company"),
                    resolved_ctx.get("metric"),
                    period_labels,
                    overall_summary,
                    "deep"
                )
            except Exception:
                sugs = []

            final_merged = {
                "indicator_card": None,
                "resolved": {
                    "company": (plan.get("context") or {}).get("company") or company,
                    "metric":  (plan.get("context") or {}).get("metric")  or metric,
                    "multi_tasks": True,
                    "periods": [p for p in period_labels if p],
                    "modes": list(set(sum([t.get('params',{}).get('modes') or [] for t in tasks if t.get('agent')=='deepanalysis_agent'], [])))
                },
                "cards": cards,
                "sections": flat_sections,
                "summary": overall_summary,
                "progress": [],
                "suggested_questions": sugs,  # ← 新增字段
            }
            yield send_progress("合并与总结", "done", group="合并")

            await asyncio.sleep(max(THOUGHT_DELAY_MS, 500)/1000.0)
            yield f"event: done\ndata:{json.dumps(final_merged, ensure_ascii=False)}\n\n"
            return


        elif intent == "policy":
            yield send_progress("正在分析政策", "start", group="执行")
            out = await asyncio.to_thread(call_policy_llm, req.question, req.policy_title)
            yield send_progress("正在分析政策", "done",  group="执行")

            # 新增：基于政策问法给推荐追问
            try:
                sugs = await asyncio.to_thread(
                    llm_suggest_followups,
                    req.question,
                    None,
                    None,
                    [],
                    (out or {}).get("analysis", ""),
                    "policy"
                )
            except Exception:
                sugs = []

            await asyncio.sleep(max(THOUGHT_DELAY_MS, 500)/1000.0)
            yield f"event: done\ndata:{json.dumps({'resolvedIntent':'policy','intent':'policy','routed_response':out,'suggested_questions':sugs}, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


# === 任务编排器：让 LLM 直接给出需要调用哪些 agent、各自参数 ===
PROMPT_TASK_PLANNER = (
  "你是企业财务问答的『任务编排器』。请阅读用户问题与默认口径（若有），"
  "直接产出要执行的 task 列表，每个 task 形如："
  '{"agent":"dataquery_agent|deepanalysis_agent","params":{"company":"...", "metric":"...", "year":2024, "quarter":"Q1", "modes":["dimension|metric|business|anomaly"]}}。'
  "要求：\n"
  "1) 能识别【多个公司 / 多个指标 / 多个期间】并拆分为多个 task，最多 8 个；\n"
  "2) 对诸如“同比/环比/达成度”类问法，若只需指标卡即可回答，就优先安排 dataquery_agent；"
  "若 context.modes 非空（来自 UI 的下钻 Tab，如 dimension/metric/business/anomaly），必须至少安排 1 个 deepanalysis_agent，并把 modes 传给它；\n"
  "3) 期间可写成 Q1..Q4；支持“某年每季”“2024Q1到2025Q2”“近四个季度”“至今”等自然语言；\n"
  "4) 缺省信息按 today 与 defaults 合理补全；\n"
  "5) 严格返回 JSON："
  '{"tasks":[{"agent":"...","params":{...}}, ...], "aggregation_hints":{"want_cards":true,"want_sections":true},'
  '"context":{"company":(可选),"metric":(可选)}}；不要多余文本。'
)

PROMPT_FINAL_SYNTHESIS = (
  "你是企业集团财务分析师。请把给定的内容整合为**一次性完整总结**：\n"
  "输入含：resolved（公司/指标/期间/模式），cards（指标卡），sections（维度/业务/异动/政策/行业新闻等），"
  "以及 period_summaries（逐期摘要，如有）。\n"
  "输出要求（中文，无需编号）：\n"
  "1) 先**指标整体描述**（水平、同比/环比方向与量级、是否达成目标）。\n"
  "2) **下钻结果**：合并维度/业务拆解要点，指出**贡献度高**与**异常项**（逐条点出维度/公司/业务）。\n"
  "3) **政策与行业要点（仅一次）**：结合 sections 中的 policy/policy_list/industry_news，\n"
  "   - 先一句话说明与『resolved.metric』的关系与方向；\n"
  "   - 给出**影响路径/可能滞后期**；\n"
  "   - 提供**2~3 条可执行建议**（用动词开头，如“关注…/优化…/配置…”）；\n"
  "   - 不要出现“候选/筛选/未命中”等措辞；若信息不足，简述原因并给出下一步（例如补数据、扩大时间范围）。\n"
  "4) **风险**与**建议方向**：分别给出 2-3 条，建议可操作。\n"
  "注意：必须综合所有子任务内容后再下结论；不要重复粘贴数据表，不要写思考或步骤。"
)





# === 多期下钻·规划器（让 LLM 决定“该调用几次、分别是哪几期”） ===
PROMPT_MULTI_PLAN = (
  "你是财务分析的『多期下钻规划器』。把用户问句里的时间范围解析成一个有序的 period 列表，"
  "每个 period 为 {\"year\": 2024, \"quarter\": \"Q1\"}。"
  "允许的表达包括：某年每个季度、2024Q1到2025Q2、近四个季度、至今/截至当前季度等。"
  "规则：1) 展开成显式的 year 与 quarter（Q1..Q4）；2) 去重、按时间先后排序；3) 最多 8 期；"
  "4) 如无法确定则回退为单一期（优先使用已解析/默认的 year+quarter）；"
  "5) 只返回 JSON：{\"periods\":[...],\"company\":(可选),\"metric\":(可选),\"reason\":(可选)}。"
)

def llm_make_task_plan(question: str,
                       company: str|None, metric: str|None,
                       year: int|None, quarter: str|None,
                       modes: Optional[List[str]] = None) -> dict:
    today = datetime.today()
    cur_year = today.year
    cur_q = f"Q{(today.month-1)//3 + 1}"
    user = {
        "question": question,
        "defaults": {"company": company, "metric": metric, "year": year, "quarter": quarter},
        "today": {"year": cur_year, "quarter": cur_q},
        "context": {"modes": list(modes or [])}  # ★ 现在来自入参
    }

    try:
        content = call_llm_chat(system="任务编排器",
                                user=f"{PROMPT_TASK_PLANNER}\n\n{json.dumps(user, ensure_ascii=False)}",
                                temperature=0.2)
        s = str(content or "").strip().strip("`")
        if s.lower().startswith("json"): s = s[4:].strip()
        plan = json.loads(s)
        tasks = []
        for t in plan.get("tasks", [])[:8]:
            agent = str(t.get("agent") or "").strip()
            params = t.get("params") or {}
            if not agent or not isinstance(params, dict):
                continue
            q = str(params.get("quarter") or "").upper()
            if q and not q.startswith("Q"):
                try:
                    q = f"Q{int(q)}"
                    params["quarter"] = q
                except Exception:
                    pass
            tasks.append({"agent": agent, "params": params})
        plan["tasks"] = tasks
        return plan
    except Exception:
        q0 = (quarter or "Q1").upper()
        if not q0.startswith("Q"):
            try:
                q0 = f"Q{int(q0)}"
            except Exception:
                q0 = "Q1"
        return {"tasks": [{"agent": "dataquery_agent", "params": {
            "company": company, "metric": metric, "year": year, "quarter": q0
        }}]}



def llm_make_multi_plan(question: str, company: str|None, metric: str|None,
                        default_year: int|None, default_quarter: str|None) -> dict:
    today = datetime.today()
    cur_year = today.year
    m = today.month
    cur_q = f"Q{(m-1)//3 + 1}"
    user = {
        "question": question,
        "defaults": {"company": company, "metric": metric,
                     "year": default_year, "quarter": default_quarter},
        "today": {"year": cur_year, "quarter": cur_q}
    }
    try:
        raw = call_llm_chat(system="多期规划器",
                            user=f"{PROMPT_MULTI_PLAN}\n\n{json.dumps(user, ensure_ascii=False)}",
                            temperature=0.2)
        s = str(raw or "").strip().strip("`")
        if s.lower().startswith("json"): s = s[4:].strip()
        j = json.loads(s)
        if isinstance(j, dict) and isinstance(j.get("periods"), list):
            seen = set()
            periods = []
            for p in j["periods"]:
                try:
                    y = int(p.get("year"))
                    q = str(p.get("quarter") or "").upper()
                    if not q.startswith("Q"): q = f"Q{int(q)}"
                    key = (y, q)
                    if key not in seen:
                        seen.add(key); periods.append({"year": y, "quarter": q})
                except Exception:
                    continue
            if periods:
                j["periods"] = periods[:8]
                return j
    except Exception:
        pass

    y = int(default_year or cur_year)
    q = (default_quarter or cur_q).upper()
    return {"periods": [{"year": y, "quarter": q}], "company": company, "metric": metric}

# === 多期下钻·总括总结（把多期的 sections/summary 做横向比较） ===
PROMPT_MULTI_SUMMARY = (
  "你是财务分析师。给定多个期次的下钻结果摘要（每期一段），请输出一个跨期对比总结，"
  "要求：1) 先给一句话总括；2) 列出同比/环比的关键变化与驱动；3) 指出趋势转折、一次性因素；"
  "4) 最后给 2-3 条可执行建议。只输出中文自然段，不要列表编号。"
)

def llm_cross_period_summary(company: str|None, metric: str|None, period_summaries: list[str]) -> str:
    ctx = {
      "company": company, "metric": metric,
      "period_summaries": period_summaries[:8]
    }
    try:
        s = call_llm_chat(system="跨期总结", user=f"{PROMPT_MULTI_SUMMARY}\n\n{json.dumps(ctx, ensure_ascii=False)}",
                          temperature=0.3, want_json=False)
        return s.strip()
    except Exception:
        return "（跨期总结生成失败，建议逐期阅读上文要点。）"

def llm_final_synthesis(resolved: dict, cards: list, sections: list, period_summaries: list[str]) -> str:
    ctx = {
        "resolved": resolved,
        "cards": cards[:24],
        "sections": sections[:24],
        "period_summaries": period_summaries[:8],
    }
    try:
        s = call_llm_chat(
            system="最终整合总结",
            user=f"{PROMPT_FINAL_SYNTHESIS}\n\n{json.dumps(ctx, ensure_ascii=False)}",
            temperature=0.3
        )
        return s.strip()
    except Exception as e:
        return f"（综合总结生成失败：{e}）"

    
PROMPT_INTENT = (
  "你是企业财务问答的意图区分器与槽位抽取器。请阅读用户问题，严格返回 JSON："
  '{"intent":"dataquery|deep|policy|other",'
  '"modes":["dimension","metric","business","anomaly"],'
  '"confidence":0.0,'
  '"reason":"中文简述",'
  '"company":(公司名称或null),'
  '"metric":(指标名称或null),'
  '"periods":[{"year":2024,"quarter":"Q1"}, ...]}'
  " 说明："
  " - dataquery=取数/是多少/查询值/是什么；deep=分析/下钻/归因/同比/环比；policy=政策影响；"
  " - 若问题含“某年各季度/全年逐季”等，必须把该年展开为 Q1..Q4；"
  " - 若只出现“2024Q2~2025Q1”等范围，展开为离散期并按时间先后排序；"
  " - 无法确定的槽位置为 null 或空数组；"
  " - 若提供了【历史对话turns】，请综合上下文补齐槽位：例如上一轮提供了公司/指标，本轮只说“要2025年Q1的”，也必须解析出完整 company/metric/period。"
  " - 只返回 JSON，不要多余文本。"
)


# === 生成阶段话术（让模型自己“说话”） ===
PROMPT_THOUGHT = (
  "你是企业财务分析助手。请根据【阶段/已有意图/模式】给出第一人称、口语化的一句或两句进度话术（≤50字）。"
  "规则："
  " - 若阶段=意图识别 且 已有意图=other：输出“我判断这可能不是财务/政策问题，会提醒你修改提问”。"
  " - 若已有意图=dataquery：输出“我先确认公司、指标、期间，再去取数”。"
  " - 若已有意图=deep：输出“我按所选模式做下钻，先定口径再分析”。"
  " - 若已有意图=policy：输出“我先梳理政策关键词与口径，再给影响路径”。"
  " - 其余按常规说明，不要列点，不要官话。只输出话术。"
)

# === 推荐追问生成器（新增） ===
PROMPT_SUGGEST_FOLLOWUPS = (
  "你是企业财务分析助手。基于用户原始问题、已解析的公司/指标/期间，以及（若有的）本轮结论，"
  "只生成 3 条**财务型“可直接发送”的推荐追问**，用于继续做“指标下钻/问数”。必须遵守：\n"
  "1) 每条问题**必须显式写出公司全名、指标名、具体期间**（年+季度如“2024Q2”，或明确区间如“2024Q1~2024Q4”）；\n"
  "   不能出现“该公司/该指标/本期/上期”等指代词；期间范围限定为2024年Q1至2025年Q2\n"
  "2) 题型限定为：指标问数/下钻分析/维度拆解/与同口径强相关指标；\n"
  "   不要政策/新闻/宏观/战略/主观判断类问题；\n"
  "3) 若 periods 给出多个期次：\n"
  "   - 单期追问优先使用**最新一期**；\n"
  "   - 同比需**写明两期**（如“2024Q2 与 2023Q2”）；环比需**写明两期**（如“2024Q2 与 2024Q1”）；\n"
  "4) 每条≤25字，中文短句，避免口号；内容彼此不要重复；\n"
  '输出严格 JSON：{"suggestions":["…","…","…"]}；只输出 JSON。'
)


def llm_suggest_followups(question: str,
                          company: Optional[str],
                          metric: Optional[str],
                          periods: List[str],
                          summary: str = "",
                          intent: str = "dataquery",
                          max_n: int = 3) -> List[str]:
    """
    仅通过 Prompt 约束生成“指标下钻/问数型”推荐问题；不依赖关键字白名单。
    上限默认 3 条，可通过 max_n 调整。
    """
    ctx = {
        "question": question,
        "company": company,
        "metric": metric,
        "periods": periods[:4],
        "intent": intent,
        "summary": (summary or "")[:1200],
    }
    try:
        out = call_llm_chat(
            system="推荐追问生成器",
            user=f"{PROMPT_SUGGEST_FOLLOWUPS}\n\n{json.dumps(ctx, ensure_ascii=False)}",
            temperature=0.4,
            want_json=True
        ) or {}
        arr = out.get("suggestions") or []
        sugs: List[str] = []
        for s in arr:
            if not isinstance(s, str):
                continue
            t = s.strip().strip("。").replace("\u3000", " ").strip()
            if not t:
                continue
            # 统一结尾问号
            if not (t.endswith("？") or t.endswith("?")):
                t = t + "？"
            if t not in sugs:
                sugs.append(t)
        # 固定上限为 3
        return sugs[:max_n]
    except Exception:
        return []

def gen_stream_thought(phase: str, question: str, intent: Optional[str] = None, modes: Optional[List[str]] = None) -> str:
    try:
        modes_str = ", ".join(modes or []) if modes else ""
        user = f"阶段：{phase}\n用户问题：{question}\n若已有意图：{intent or '未知'}；下钻模式：{modes_str or '无'}。"
        return call_llm_chat(system="阶段话术", user=f"{PROMPT_THOUGHT}\n\n{user}", temperature=0.4, timeout=20).strip()
    except Exception:
        # LLM 不可用时，给一个温和的退路
        fallback = {
            "意图识别": "我先判断你是在要一个数，还是要做下钻分析。",
            "计划":     "我会先把口径说清楚，再去取需要的数据，然后给出结果。",
            "取数准备": "我先按公司/指标/期间把口径定好，再开始取数。",
            "分析准备": "我会先把分析维度定下来，再去抓基础数据和政策口径。",
        }
        return fallback.get(phase, "我先把步骤梳理一下，再继续。")

def llm_classify_intent(question: str, history: Optional[List[Dict[str, str]]] = None) -> Optional[Dict[str, Any]]:
    if not (LLM_BASE and LLM_KEY and LLM_MODEL):
        return None
    try:
        hist_txt = ""
        if history:
            N = max(1, DIALOG_CONTEXT_MAX_ROUNDS)
            turns = history[-(N*2):]
            lines = []
            for t in turns:
                role = "用户" if (t.get("role") == "user") else "助手"
                cont = (t.get("content") or "").strip()
                if cont:
                    lines.append(f"{role}：{cont}")
            if lines:
                hist_txt = "历史对话：\n" + "\n".join(lines) + "\n\n"

        raw = call_llm_chat(system="意图识别",
                            user=f"{PROMPT_INTENT}\n\n{hist_txt}当前问题：{question}",
                            temperature=0.1)

        # —— 容错提取 JSON：去反引号、去 'json' 前缀、从代码块抽取
        s = str(raw or "").strip()
        s = s.strip("`")  # 去成对反引号的粗处理
        if s.lower().startswith("json"):
            s = s[4:].strip()
        try:
            data = json.loads(s)
        except Exception:
            data = _extract_json_block(s) or {}

        if isinstance(data, dict) and data.get("intent"):
            return data

        # 兜底（极少走到）：返回一个最小结构，至少不至于 None
        from typing import cast
        hit_intent, conf, why = heuristic_intent(question)
        return {
            "intent": cast(str, hit_intent.value),
            "modes": guess_deep_modes(question) if hit_intent.value == "deep" else [],
            "confidence": conf,
            "reason": f"启发式：{why}"
        }
    except Exception:
        # 出错也给一个兜底，不让上游拿到 None
        hit_intent, conf, why = heuristic_intent(question)
        return {
            "intent": hit_intent.value,
            "modes": guess_deep_modes(question) if hit_intent.value == "deep" else [],
            "confidence": conf,
            "reason": f"启发式：{why}"
        }


def llm_structured_parse_slots(question: str,
                               history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """
    仅依赖大模型（不做正则/启发式兜底）抽取：
    - company（映射到目录的规范名）
    - metric（映射到目录 canonical_name）
    - periods: [{"year": 2024, "quarter": "Q1"}, ...] —— 相对时间必须展开
    """
    companies, metrics = _catalog_payload_for_llm()
    now_str = datetime.now().strftime("%Y-%m-%d")
    hint_latest = _latest_period_any()  # 可能为 None，也原样传给 LLM

    hist_txt = ""
    if history:
        N = max(1, DIALOG_CONTEXT_MAX_ROUNDS)
        turns = history[-(N * 2):]
        lines = []
        for t in turns:
            role = "用户" if (t.get("role") == "user") else "助手"
            cont = (t.get("content") or "").strip()
            if cont:
                lines.append(f"{role}：{cont}")
        if lines:
            hist_txt = "历史对话：\n" + "\n".join(lines) + "\n\n"

    sys_prompt = (
        "你是财务语义解析器。任务：从问题中抽取并规范化【公司、指标、期间】。\n"
        "【重要约束】\n"
        "1) 公司 只能从 companies[].display_name/aliases 映射为 display_name；\n"
        "2) 指标 只能从 metrics[].canonical_name/aliases 映射为 canonical_name；\n"
        "3) 期间 输出 periods 数组，元素为 {\"year\": 2024, \"quarter\": \"Q1\"}。\n"
        "   对“最近/上季度/近四个季度/今年/本季度”等相对时间，必须**展开为明确年+季**。\n"
        "   可参考 hint_latest_any 作为“最近一期”的锚点（若为空则按 now 推算）；\n"
        "4) 不能确定时，不要猜测，设置 need_clarification=true，并给出中文单句 ask（最小追问）。\n"
        "【输出】严格 JSON：\n"
        "{\"company\":(或null),\"metric\":(或null),\"periods\":[{\"year\":2024,\"quarter\":\"Q1\"},...],"
        "\"need_clarification\":bool,\"ask\":\"...或空串\"}\n"
        "只输出 JSON，不要反引号、不要代码块、不要说明文字。"
    )
    user_payload = {
        "now": now_str,
        "hint_latest_any": hint_latest,     # 例如 {"year":2025,"quarter":2} 或 null
        "companies": companies,
        "metrics": metrics,
        "question": question,
        "history_hint": hist_txt,
    }
    # 直接请求 JSON；不做本地兜底
    out = call_llm_chat(system="槽位抽取", user=f"{sys_prompt}\n\n{json.dumps(user_payload, ensure_ascii=False)}",
                        temperature=0.0, want_json=True)
    return out or {}

def _norm_quarter(q: Optional[str]) -> Optional[str]:
    if not q: return None
    s = str(q).strip().upper().replace("Ｑ", "Q")
    if s.startswith("Q"):
        return f"Q{int(s[1:])}" if s[1:].isdigit() else s
    return f"Q{int(s)}" if s.isdigit() else None

def llm_extract_slots(question: str, history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """
    仅依赖 LLM（不启用正则/启发式）来抽取 company/metric/periods，
    并支持“最近一个季度/近四个季度/上季度/今年等”相对时间的展开。
    """
    data = llm_structured_parse_slots(question, history) or {}
    company = data.get("company")
    metric  = data.get("metric")
    periods = data.get("periods") or []

    norm_periods: List[Dict[str, Any]] = []
    for p in periods:
        try:
            y = int(p.get("year"))
            q = _norm_quarter(p.get("quarter"))
            if y and q:
                norm_periods.append({"year": y, "quarter": q})
        except Exception:
            continue

    return {"company": company, "metric": metric, "periods": norm_periods}

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

def _extract_json_block(s: str) -> dict | None:
    try:
        import re, json
        m = re.search(r"```json\s*([\s\S]*?)\s*```", s.strip()) or re.search(r"\{[\s\S]*\}$", s.strip())
        if not m: return None
        return json.loads(m.group(1) if m.lastindex else m.group(0))
    except Exception:
        return None
# ====== LLM（可选：用于政策分析 & 低置信分类，保持最简实现） ======
def call_llm_chat(system: str, user: str, temperature: float = 0.2, timeout: int = 45, want_json: bool = False):
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
        out_text = d2["choices"][0]["message"]["content"]
    else:
        out_text = data["choices"][0]["message"]["content"]
    if want_json:
        return _extract_json_block(out_text) or {}
    return out_text



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
def _google_cse_policy_search(company_name: str|None, metric: str|None,
                              year: int|None, quarter: str|None,
                              limit: int = 10,
                              extra_keywords: Optional[List[str]] = None) -> list[dict]:
    import requests, urllib.parse
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        raise RuntimeError("未配置 GOOGLE_API_KEY / GOOGLE_CSE_ID")

    q_parts = []
    if company_name: q_parts.append(company_name)
    if metric:       q_parts.append(metric)
    if year and quarter: q_parts.append(f"{year}{quarter}")
    # 政策类关键词 + 行业提示词
    base_kw = ["政策", "通知", "指导意见", "监管", "央行", "发改委", "财政部", "新规", "解读"]
    if extra_keywords:
        base_kw += list(extra_keywords)
    q_parts.append(" OR ".join(base_kw))

    q = " ".join(str(x) for x in q_parts if x)
    url = ("https://www.googleapis.com/customsearch/v1?"
           f"key={urllib.parse.quote(GOOGLE_API_KEY)}&cx={urllib.parse.quote(GOOGLE_CSE_ID)}&num={limit}&q={urllib.parse.quote(q)}")
    r = requests.get(url, timeout=20); r.raise_for_status()
    data = r.json()
    items = data.get("items") or []
    out = []
    for it in items:
        link = it.get("link") or ""
        try:
            from urllib.parse import urlparse
            host = urlparse(link).netloc
        except Exception:
            host = ""
        out.append({"title": it.get("title"), "source": host, "snippet": it.get("snippet")})
    return out



# 只在 intent 层做一次“政策检索”。输出：
#   - policy_list（Top3，中文表头 + 中文摘要）
#   - 或 policy_info（失败/无命中时的原因）
# 不再生成《政策影响与建议》段落，最终由综合总结吸收政策上下文。
def run_policy_once_at_intent(send_progress, flat_sections: list,
                              company: str|None, metric: str|None,
                              year: int|None, quarter: str|None):
    step_tip = "政策检索（一次）"
    send_progress(step_tip, "start", group="政策")

    # 思考展示（只说明方法，不阻塞）
    thought_str = (
        "我会基于公司/指标/期间做一次政策检索（Google CSE），"
        "结合下钻文本猜行业作提示词；取 Top3 并生成中文摘要，供最终总结引用。"
    )
    send_progress("思考·政策分析", "doing", group="政策", detail=thought_str)
    send_progress("思考·政策分析", "done",  group="政策")

    # —— 从下钻结果里猜行业，作为检索提示（金融/地产/港口…）
    industry_hints = _guess_industries_from_sections(flat_sections, maxn=3)

    # ① 检索（适度扩大召回），失败时只记录原因，不抛出
    policy_hits, reason_msg = [], None
    try:
        policy_hits = _google_cse_policy_search(
            company, metric, year, quarter,
            limit=12, extra_keywords=industry_hints + ["中国", "国内", "监管", "新规"]
        )
    except Exception:
        # 不把原始异常或 URL 暴露给前端
        # reason_msg = "政策检索失败（可能是 CSE 配置/配额或查询过长）。"
        return

    # ② 生成“中文简要概括”并输出中文表头（过滤不可读条目，如仅是网址）
    def _is_bad_item(ttl: str, src: str, brief: str) -> bool:
        bad = (not ttl) or (not brief) or brief.startswith("http") or src.endswith(".pdf")
        return bool(bad)

    def _zh_brief_item(ttl: str, snip: str, max_sents=2) -> str:
        # 轻量中文摘要：控制在 1~2 句
        return _brief_zh_summary("政策条目摘要", {"title": ttl, "snippet": snip}, max_sents=max_sents) or ""

    clean_rows = []
    for h in (policy_hits or []):
        brief = _zh_brief_item(h.get("title") or "", h.get("snippet") or "", max_sents=2)
        if _is_bad_item(h.get("title") or "", h.get("source") or "", brief or h.get("snippet") or ""):
            continue
        clean_rows.append({"标题": h.get("title"), "来源": h.get("source"), "摘要": brief})
        if len(clean_rows) >= 3:
            break

    if clean_rows:
        flat_sections.append({
            "type":  "policy_list",        # 前端已有渲染；也兼容旧的 policy_candidates
            "title": "相关政策（Top3）",
            "table": clean_rows
        })
        send_progress(step_tip, "progress", group="政策", detail=f"Top3/{len(policy_hits)}")
    # else:
    #     if reason_msg is None:
    #         reason_msg = "未命中与本期业务密切相关的权威政策来源（或结果质量不足）"
    #     flat_sections.append({"type": "policy_info", "title": "政策检索状态", "message": reason_msg})

    # 结束
    send_progress(step_tip, "done", group="政策")



# 关键词到行业的极简映射（可按需扩展）
_INDUSTRY_PATTERNS = [
    ("金融", ["金融","银行","券商","证券","保险","信托","资管","财险","寿险"]),
    ("地产", ["地产","房地产","房产","置业","开发","物业"]),
    ("港口", ["港口","码头","港务","港航","集装箱"]),
    ("钢铁", ["钢铁","钢材"]),
    ("煤炭", ["煤炭","煤业"]),
    ("有色", ["有色","铜业","铝业","稀土"]),
    ("化工", ["化工","化学","化纤"]),
    ("电力", ["电力","电网","发电"]),
    ("航空机场", ["机场","航空"]),
    ("公路铁路", ["铁路","公路","高速"]),
    ("物流", ["物流","货运","仓储"]),
    ("汽车", ["汽车","车业","车企"]),
    ("互联网/软件", ["互联网","软件","游戏","传媒","在线"]),
]

def _guess_industry_from_name(name: str) -> str | None:
    s = str(name or "").lower()
    for ind, kws in _INDUSTRY_PATTERNS:
        if any(k.lower() in s for k in kws):
            return ind
    return None
def _guess_industries_from_sections(flat_sections: list[dict], maxn: int = 3) -> list[str]:
    text = " ".join([
        (s.get("title") or "") + " " + (s.get("message") or "")
        for s in (flat_sections or [])
        if isinstance(s, dict)
    ])
    hits = []
    for ind, kws in _INDUSTRY_PATTERNS:
        if any(k in text for k in kws):
            hits.append(ind)
    # 去重保序
    seen, out = set(), []
    for x in hits:
        if x not in seen:
            seen.add(x); out.append(x)
    return out[:maxn]

def _brief_zh_summary(context_title: str, ctx: dict, max_sents: int = 3) -> str:
    prompt = (
        f"请用中文写不超过{max_sents}句的简要概括，直给结论、避免口号与套话。"
        "概括要围绕与本期指标/行业相关的关键影响与趋势。"
    )
    try:
        out = call_llm_chat(system=context_title, user=f"{prompt}\n\n{json.dumps(ctx, ensure_ascii=False)}",
                            temperature=0.3, timeout=40)
        return (out or "").strip()
    except Exception:
        return ""
def _zh_brief_item(title: str, snippet: str, max_sents: int = 2) -> str:
    """
    把（可能是英文的）标题+摘要压缩成中文 1~2 句，不要口号和空话。
    """
    prompt = (
        f"请把下面的标题和摘要压缩成**中文**{max_sents}句以内，直给关键信息，避免口号：\n"
        "【标题】{title}\n【摘要】{snippet}\n"
        "输出只要中文句子，不要列表编号或引号。"
    )
    try:
        return call_llm_chat(system="中文简要概括", user=prompt.format(title=title or "", snippet=snippet or ""),
                             temperature=0.2, timeout=35).strip()
    except Exception:
        # 极端兜底：只取前 60 字
        s = (snippet or title or "").strip()
        return s[:60]
# 丢弃不可读/无关条目：标题太弱、纯链接、英文客服页等
_URL_RE = re.compile(r"(https?://|www\.)", re.I)
_BAD_DOMAINS = {"scribd.com", "global.americanexpress.com"}
_BAD_TITLE_PREFIX = ("search", "untitled")
_BAD_TITLES = {"pdf", "首页", "网站"}

def _is_bad_item(title: str, source: str, snippet: str) -> bool:
    t = (title or "").strip()
    s = (snippet or "").strip()
    host = (source or "").lower()

    if not t or t.lower() in _BAD_TITLES or t.lower().startswith(_BAD_TITLE_PREFIX):
        return True
    if host in _BAD_DOMAINS:
        return True
    # 摘要或标题像 URL
    if _URL_RE.search(t) or _URL_RE.search(s):
        return True
    # 过度英文：CJK 占比 < 20%（粗略启发式）
    mix = t + s
    cjk = sum(1 for ch in mix if "\u4e00" <= ch <= "\u9fff")
    if mix and cjk * 5 < len(mix):
        return True
    return False

def _strip_site_suffix(title: str, source: str) -> str:
    """
    去掉搜索标题尾部的站点后缀（如 "…… - 21世纪经济报道" / "…… | 某某官网" 等）。
    由于“来源”字段单独展示站点，这里把尾部站点名移除以避免重复。
    规则：
      - 按最后一次分隔符（" - "、" | "、" —— "、" — "、" _ "）切分；
      - 若右半段较短（≤24）或包含常见站点词（官网/网站/新闻/日报/经济/时报/财经/资讯/研究/研报/研究院/证券/金融/新闻网/传媒/科技），则裁掉右半段；
      - 同时去掉末尾省略号/多余空格。
    """
    if not title:
        return title
    t = str(title).strip()
    host = (source or "").lower().replace("www.", "")
    base = host.split(":")[0]
    if "." in base:
        base = base.split(".")[0]  # 取主干：例如 21jingji

    seps = [" - ", " | ", " —— ", " — ", " _ "]
    for sep in seps:
        if sep in t:
            left, right = t.rsplit(sep, 1)
            r = right.strip()
            # 触发裁剪的条件：短尾部 / 包含常见站点词 / 与域名主干相近
            site_keywords = ("首页","官网","网站","新闻","日报","经济","时报","财经","资讯","研究","研报","研究院","证券","金融","新闻网","传媒","科技")
            if (len(r) <= 24) or any(k in r for k in site_keywords) or (base and base in r.lower()):
                t = left.strip()
                break
    # 去掉末尾省略号/点号
    t = re.sub(r"[…\.\s]+$", "", t)
    return t


def _google_cse_news_search(query: str, limit: int = 6) -> list[dict]:
    """通用新闻检索（同 Google CSE），返回 [{title,source,snippet}]"""
    import requests, urllib.parse
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        raise RuntimeError("未配置 GOOGLE_API_KEY / GOOGLE_CSE_ID")
    ## url = ("https://www.googleapis.com/customsearch/v1?"
    #        f"key={urllib.parse.quote(GOOGLE_API_KEY)}&cx={urllib.parse.quote(GOOGLE_CSE_ID)}&num={limit}&q={urllib.parse.quote(query)}")
    # 原： r = requests.get(url, timeout=20); r.raise_for_status()
    params = {
        "key": GOOGLE_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "num": limit,
        "q": query,  
        "lr": "lang_zh-CN",   # 只要中文
        "hl": "zh-CN",
        "safe": "off"
    }
    r = requests.get("https://www.googleapis.com/customsearch/v1", params=params, timeout=20)
    r.raise_for_status()

    data = r.json()
    items = data.get("items") or []
    out = []
    for it in items:
        link = it.get("link") or ""
        try:
            from urllib.parse import urlparse
            host = urlparse(link).netloc
        except Exception:
            host = ""
        out.append({"title": it.get("title"), "source": host, "snippet": it.get("snippet")})
    return out

def _pick_top_entities_from_sections(flat_sections: list[dict], topk: int = 2) -> list[str]:
    """
    从维度/业务类 section 的 table 里提取“可能的实体名”，尽量挑“贡献度最大”的行。
    兼容字段名：company/name/维度/子公司/板块/事业部/业务/dimension/entity 等。
    """
    cand = []
    def _first_str(d: dict) -> str|None:
        prefer_keys = ["company","name","维度","子公司","板块","事业部","业务","dimension","entity","title"]
        for k in prefer_keys:
            v = d.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        # 退化：任取一个字符串字段
        for k, v in d.items():
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    def _score(d: dict) -> float:
        # 依据“贡献/变化/增量”等数值估个权重；没有就 0
        keys = ["贡献","贡献度","变化","变动","增量","同比","环比"]
        sc = 0.0
        for k, v in d.items():
            if any(kw in str(k) for kw in keys):
                try:
                    sc = max(sc, abs(float(v)))
                except Exception:
                    pass
        return sc

    for s in (flat_sections or []):
        t = (s.get("type") or "").lower()
        if t not in {"dimension","business","anomaly"} and ("维度" not in (s.get("title") or "")) and ("业务" not in (s.get("title") or "")):
            continue
        rows = s.get("table") or []
        if not isinstance(rows, list): 
            continue
        scored = []
        for r in rows:
            if not isinstance(r, dict): 
                continue
            name = _first_str(r)
            if not name: 
                continue
            scored.append((name, _score(r)))
        scored.sort(key=lambda x: x[1], reverse=True)
        for name, _ in scored[:max(1, topk)]:
            cand.append(name)
    # 去重保序
    seen, out = set(), []
    for x in cand:
        if x not in seen:
            seen.add(x); out.append(x)
    return out[:topk]




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

def run_industry_or_macro_enrichment_at_intent(send_progress, flat_sections: list,
                                               company: str|None, metric: str|None,
                                               year: int|None, quarter: str|None):
    step_tip = "行业/宏观检索（一次）"
    send_progress(step_tip, "start", group="政策")

    # 从表格与文字里综合识别行业（最多3个）
    picks = _pick_top_entities_from_sections(flat_sections, topk=4)
    inds_from_names = [x for x in {_guess_industry_from_name(n) for n in picks} if x]
    inds_from_text  = _guess_industries_from_sections(flat_sections, maxn=3)
    industries = []
    for x in inds_from_names + inds_from_text:
        if x not in industries:
            industries.append(x)
    industries = industries[:3]

    q_label = f"{year}{quarter}" if (year and quarter) else ""
    rows, reason = [], None

    # 针对不同行业使用更贴近中国场景的提示词
    def _extra_for(ind: str) -> str:
        if ind == "港口":  return " 中国 集装箱 吞吐量 外贸 口岸"
        if ind == "金融":  return " 中国 货币政策 利率 社融 M2 贷款"
        if ind == "地产":  return " 中国 房地产 销售 融资 三支箭 房贷 土地"
        return " 中国 数据 趋势 政策"
    try:
        if industries:
            cap = 6
            per = max(1, 6 // len(industries))
            for ind in industries:
                query = f"{ind} 行业 {q_label}{_extra_for(ind)}"
                hits = _google_cse_news_search(query, limit=per)
                for h in (hits or [])[:per]:
                    src = h.get("source") or ""
                    ttl_raw = h.get("title") or ""
                    snp_raw = h.get("snippet") or ""
                    # 1) 标题清洗：去掉“ - 站点名 / | 站点名 …”
                    ttl = _strip_site_suffix(ttl_raw, src)
                    # 2) 中文摘要（最多2句）
                    brief = _zh_brief_item(ttl_raw, snp_raw, max_sents=2)
                    # 3) 过滤：摘要是网址或以英文为主的，直接不展示该条
                    if _is_bad_item(ttl, src, brief or snp_raw):
                        continue
                    rows.append({"领域": ind, "标题": ttl, "来源": src, "摘要": brief})
                if len(rows) >= cap:
                    break

        else:
            # 无法识别行业 → 宏观 + 指标
            metric_kw = (metric or "").strip() or "经营活动现金流 应收账款 融资环境"
            query = f"宏观 {metric_kw} {q_label} 中国 数据 趋势 政策"
            hits = _google_cse_news_search(query, limit=3)
            for h in (hits or [])[:3]:
                src = h.get("source") or ""
                ttl_raw = h.get("title") or ""
                snp_raw = h.get("snippet") or ""
                ttl = _strip_site_suffix(ttl_raw, src)
                brief = _zh_brief_item(ttl_raw, snp_raw, max_sents=2)
                if _is_bad_item(ttl, src, brief or snp_raw):
                    continue
                rows.append({"领域": "宏观", "标题": ttl, "来源": src, "摘要": brief})

    except Exception as e:
        reason = f"{e}"

    sec = {"type":"industry_news","title":"行业/宏观相关新闻（精要）","table": rows}
    msg = _brief_zh_summary("行业/宏观要点（建议导向）",
                            {"company": company, "metric": metric, "period": q_label,
                             "industries": industries, "news": rows}, max_sents=4)
    if msg: sec["message"] = msg
    if not rows and reason:
        sec["message"] = (sec.get("message") or "") + f"\n（检索未产出结果：{reason}）"

    flat_sections.append(sec)
    detail = f"{len(rows)} 条" + (f"；行业={','.join(industries)}" if industries else "；行业未识别，已走宏观")
    send_progress(step_tip, "done", group="政策", detail=detail)



# ====== 路由入口 ======
@app.post("/intent/route", response_model=RouteResp)
def route(req: RouteReq, _=Depends(require_token)):
    ui_tab_str = str(req.ui_tab or "").lower()
    force_deep_by_ui = req.force_deep or (ui_tab_str in {"analysis", "deep", "drill", "下钻", "分析下钻"})

    if (req.selected_modes or req.modes or force_deep_by_ui):
        modes = req.selected_modes or req.modes or ["dimension"]
        intent = Intent.deep; conf = 0.99; reason = "UI：选择了下钻模式/Tab或 force_deep"
    else:
        llm = llm_classify_intent(req.question, (req.dialog_context or {}).get("turns"))
        if llm:
            it_str = (llm.get("intent") or "other").lower()
            intent = Intent(it_str) if it_str in {"dataquery","deep","policy","other"} else Intent.other
            conf = float(llm.get("confidence", 0.6)); reason = llm.get("reason", "LLM 分类")
            modes = llm.get("modes") or []
        else:
            intent = Intent.dataquery; conf = 0.6; reason = "LLM 不可用，默认走取数"; modes = []

    # 槽位抽取
    slots = llm_extract_slots(req.question, (req.dialog_context or {}).get("turns"))
    def pick(*vals):
        for v in vals:
            if v not in (None, "", []): return v
        return None
    company = pick(req.company, slots.get("company"))
    metric  = pick(req.metric,  slots.get("metric"))
    periods = slots.get("periods") or []
    year    = pick(req.year,    (periods[0]["year"] if periods else None))
    quarter = _norm_quarter(pick(req.quarter, (periods[0]["quarter"] if periods else None)))

    payload: Dict[str, Any] = {}
    target_agent: Optional[str] = None

    if intent == Intent.dataquery:
        target_agent = "dataquery_agent"
        payload = {"question": req.question, "company": company, "metric": metric,
                   "year": year, "quarter": quarter, "scenario": "actual"}
    elif intent == Intent.deep:
        target_agent = "deepanalysis_agent"
        modes = modes or req.modes or (["dimension"] if force_deep_by_ui else guess_deep_modes(req.question))
        if ("metric" in modes) and ("business" in modes):
            raise HTTPException(status_code=400, detail="『指标下钻』与『业务下钻』不能同时选择，请二选一。")
        payload = {"question": req.question, "company": company, "metric": metric,
                   "year": year, "quarter": quarter, "modes": modes,
                   "business_formula_metric_name": req.business_formula_metric_name}
    elif intent == Intent.policy:
        target_agent = "policy_llm"; payload = {"question": req.question, "policy_title": req.policy_title}
    else:
        target_agent = None; payload = {}

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

    return RouteResp(intent=intent, confidence=conf, reason=reason,
                     target_agent=target_agent, auto_executed=auto_executed,
                     routed_payload=payload, routed_response=routed_resp)


def llm_cards_summary(question: str, cards: list[dict]) -> str:
    """
    输入多张 indicator_card，输出 3~6 句的中文综述：
    - 识别同比/环比/目标达成等标签（若卡片包含相关字段）
    - 按时间顺序或分公司对比给出趋势、最大/最小值、异常点
    - 不编造数值，只引用卡片里的数
    """
    try:
        payload = {
            "question": question,
            "cards": [
                {
                    "company": (c.get("company") or ""),
                    "period": f"{c.get('year')}{c.get('quarter')}",
                    "metric": (c.get("metric_canonical") or c.get("metric")),
                    "current": c.get("current"),
                    "unit": c.get("unit"),
                    "refs": c.get("refs", {})
                } for c in (cards or [])
            ]
        }
        prompt = (
            "你是财务小结助手。请阅读用户问题与多张指标卡的 JSON，输出 3~6 句中文要点，"
            "包含整体趋势、极值/拐点、同比/环比/达成度（若卡片提供）等，不要编造数据。"
            "直书结论，不要出现“如下/如下所示”等指示性词。"
        )
        out = call_llm_chat(system="指标卡综述", user=f"{prompt}\n\n{json.dumps(payload, ensure_ascii=False)}", temperature=0.2)
        return (out or "").strip()
    except Exception:
        return ""

# ====== 本地调试 ======
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("intent_agent:app", host="0.0.0.0", port=18040, reload=False)
