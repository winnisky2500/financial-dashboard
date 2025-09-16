# agent/budget_agent.py
import os, io, json, csv, base64, re
from typing import List, Union, Optional
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from pydantic import BaseModel
import httpx
import pandas as pd

APP_TOKEN = os.getenv("BUDGET_AGENT_TOKEN", "")
OPENAI_BASE = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_KEY  = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

app = FastAPI(title="Budget Agent", version="0.1.0")

# 允许前端 (5173) 调用，含 Authorization 头
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "*"],
)

# === Storage: ensure bucket exists (service role only) ===
from fastapi import Body


@app.post("/storage/ensure")
async def storage_ensure(
    payload: dict = Body(...),
    authorization: Optional[str] = Header(None)
):
    _auth_check(authorization)
    bucket = (payload.get("bucket") or "").strip()
    if not bucket:
        raise HTTPException(400, "bucket required")

    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE):
        raise HTTPException(500, "Server not configured")

    base = f"{SUPABASE_URL}/storage/v1"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        # 1) probe bucket
        r = await client.get(f"{base}/bucket/{bucket}", headers=headers)
        if r.status_code == 404:
            # 2) create
            r2 = await client.post(f"{base}/bucket", headers=headers, json={"name": bucket, "public": True})
            r2.raise_for_status()
            return {"ok": True, "created": True, "public": True}
        r.raise_for_status()
        info = r.json()
        return {"ok": True, "created": False, "public": info.get("public", False)}
@app.post("/storage/upload")
async def storage_upload(payload: dict = Body(...), authorization: Optional[str] = Header(None)):
    """
    服务器侧上传文件到 Supabase Storage（使用 service_role），自动确保 bucket 存在。
    传入: {bucket, path, b64} 其中 b64 为 base64 的文件内容；默认 upsert 覆盖。
    """
    _auth_check(authorization)
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE):
        raise HTTPException(500, "Server not configured")
    bucket = (payload.get("bucket") or "").strip()
    path   = (payload.get("path") or "").strip()
    b64    = payload.get("b64")
    if not bucket or not path or not b64:
        raise HTTPException(400, "bucket/path/b64 required")

    base = f"{SUPABASE_URL}/storage/v1"
    headers_json = {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
        "Content-Type": "application/json",
    }
    headers_bin = {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
        "x-upsert": "true",
        "Content-Type": "application/octet-stream",
    }

    content = base64.b64decode(b64)

    async with httpx.AsyncClient(timeout=120) as client:
        # ensure bucket
        r = await client.get(f"{base}/bucket/{bucket}", headers=headers_json)
        if r.status_code == 404:
            r2 = await client.post(f"{base}/bucket", headers=headers_json, json={"name": bucket, "public": True})
            r2.raise_for_status()

        # upload
        r3 = await client.post(f"{base}/object/{bucket}/{path}", headers=headers_bin, content=content)
        r3.raise_for_status()
        return {"ok": True, "path": path}
@app.get("/storage/list")
async def storage_list(bucket: str, prefix: str = "", authorization: Optional[str] = Header(None)):
    _auth_check(authorization)
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE):
        raise HTTPException(500, "Server not configured")

    base = f"{SUPABASE_URL}/storage/v1"
    headers_json = {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        # ensure bucket
        r = await client.get(f"{base}/bucket/{bucket}", headers=headers_json)
        if r.status_code == 404:
            r2 = await client.post(f"{base}/bucket", headers=headers_json, json={"name": bucket, "public": True})
            r2.raise_for_status()
        # list objects
        r3 = await client.post(f"{base}/object/list/{bucket}", headers=headers_json, json={"prefix": prefix, "limit": 1000})
        r3.raise_for_status()
        items = r3.json().get("items", [])
        names = [ (prefix + it["name"]) if prefix and not prefix.endswith("/") else (prefix + it["name"]) for it in items ]
        return {"objects": names}

@app.get("/storage/download")
async def storage_download(bucket: str, path: str, authorization: Optional[str] = Header(None)):
    _auth_check(authorization)
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE):
        raise HTTPException(500, "Server not configured")

    base = f"{SUPABASE_URL}/storage/v1"
    headers_bin = {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        # 直接下载对象
        r = await client.get(f"{base}/object/{bucket}/{path}", headers=headers_bin)
        r.raise_for_status()
        return httpx.Response(200, content=r.content, headers={"content-type": "application/octet-stream"})

@app.get("/_diag")
async def diag(authorization: Optional[str] = Header(None)):
    _auth_check(authorization)
    out = {
        "has_openai_key": bool(OPENAI_KEY),
        "openai_base": OPENAI_BASE,
        "model": OPENAI_MODEL,
        "has_service_role": bool(SUPABASE_SERVICE_ROLE),
        "supabase_url": SUPABASE_URL,
        "alias_count": None,
    }
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE:
        try:
            alias = await _fetch_alias_table()
            out["alias_count"] = len(alias)
        except Exception as e:
            out["alias_count"] = f"error: {e}"
    return out

class ReadDBIn(BaseModel):
    company: str
    quarters: List[str]
    sheet: List[List[Union[str, float, int, None]]]

def _auth_check(token: Optional[str]):
    if APP_TOKEN and (token or "").replace("Bearer ","") != APP_TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")

async def _fetch_alias_table():
    url = f"{SUPABASE_URL}/rest/v1/metric_alias_catalog?select=canonical_name,aliases"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(url, headers={"apikey": SUPABASE_SERVICE_ROLE, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}"})
        r.raise_for_status()
        return r.json()

def _build_canonical_map(alias_rows):
    # aliases 是 json 数组
    amap = {}
    for row in alias_rows:
        cn = row["canonical_name"]
        for al in (row.get("aliases") or []):
            amap[str(al).strip().lower()] = cn
        amap[cn.strip().lower()] = cn
    return amap

def _map_by_alias_simple(metric_names: List[str], alias_rows) -> List[Optional[str]]:
    amap = _build_canonical_map(alias_rows)  # alias/lower -> canonical
    out: List[Optional[str]] = []
    for n in metric_names:
        cn = amap.get(str(n).strip().lower())
        out.append(cn if cn else None)
    return out

async def _llm_map_metrics(metric_names: List[str], alias_rows) -> List[Optional[str]]:
    """优先用别名表直接匹配；剩余再调用 LLM，长度不一致时做降级填充，不抛错。"""
    # 1) 先做一次直接别名匹配
    simple = _map_by_alias_simple(metric_names, alias_rows)
    if all(simple):  # 全部匹配上，直接返回
        return simple

    # 2) 调用 LLM 做补全
    system = "你是财务指标对齐助手。只返回 JSON 数组，长度与输入一致。每个元素应是 metric_alias_catalog 的 canonical_name，无法匹配用 null。"
    alias_preview = [
        {"canonical_name": r["canonical_name"], "aliases": r.get("aliases") or []}
        for r in alias_rows
    ][:200]
    user = {"metric_names": metric_names, "catalog_sample": alias_preview}

    llm_list: List[Optional[str]] = [None] * len(metric_names)
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                f"{OPENAI_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": OPENAI_MODEL,
                    "messages":[
                        {"role":"system","content":system},
                        {"role":"user","content":json.dumps(user, ensure_ascii=False)}
                    ],
                    "response_format":{"type":"json_object"}
                }
            )
            r.raise_for_status()
            data = r.json()
            txt = data["choices"][0]["message"]["content"]
            obj = json.loads(txt)
            mapped = obj.get("mapped") or obj.get("result") or obj.get("data") or []
            if isinstance(mapped, list):
                for i in range(min(len(mapped), len(metric_names))):
                    v = mapped[i]
                    llm_list[i] = v if v else None
    except Exception:
        pass  # LLM 失败就用 simple

    # 3) 组装：优先 LLM，其次 simple，仍无则 None
    canonicals = {r["canonical_name"] for r in alias_rows}
    out: List[Optional[str]] = []
    for i in range(len(metric_names)):
        cand = llm_list[i] or simple[i] or None
        out.append(cand if (cand in canonicals) else None)
    return out

async def _query_financial_metrics(company: str, quarters: List[str], canonical_names: List[str]):
    # quarters: ["2025Q1", ...]
    years = sorted({int(q[:4]) for q in quarters if len(q)>=6 and q[4]=='Q'})
    url = f"{SUPABASE_URL}/rest/v1/financial_metrics?select=metric_name,company_name,year,quarter,metric_value&company_name=eq.{company}&year=in.({','.join(map(str,years))})"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.get(url, headers={"apikey": SUPABASE_SERVICE_ROLE, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE}"})
        r.raise_for_status()
        rows = r.json()
    d = {}
    qs = set(quarters)
    cset = set(canonical_names)
    for row in rows:
        qlabel = f"{row['year']}Q{row['quarter']}"
        if qlabel in qs and row['metric_name'] in cset:
            d[(row['metric_name'], qlabel)] = row['metric_value']
    return d

def _fill_sheet_with_values(sheet, quarters, metrics, values_map):
    # sheet[0] = header；sheet[i][0] = 指标名
    # metrics = canonical_name（与 sheet 第一列行名一一对应）
    header = sheet[0]
    col_map = {quarters[i]: i+1 for i in range(len(quarters))}  # q -> col index
    for r in range(1, len(sheet)):
        name = str(sheet[r][0] or "")
        canonical = metrics[r-1] if r-1 < len(metrics) else None
        if not canonical:
            continue
        for q in quarters:
            c = col_map[q]
            cell = sheet[r][c] if c < len(sheet[r]) else None
            # 公式不覆盖；空/数字才覆盖
            if isinstance(cell, str) and cell.startswith("="):
                continue
            key = (canonical, q)
            if key in values_map:
                # 写入数值
                while c >= len(sheet[r]):
                    sheet[r].append(None)
                sheet[r][c] = float(values_map[key])
    return sheet

@app.post("/ai/read-db")
async def read_db(data: ReadDBIn, authorization: Optional[str] = Header(None)):
    _auth_check(authorization)
    if not (OPENAI_KEY and SUPABASE_URL and SUPABASE_SERVICE_ROLE):
        raise HTTPException(500, "Server not configured")

    alias_rows = await _fetch_alias_table()
    metric_names = [str(row[0] or "") for row in data.sheet[1:]]  # 第一列
    mapped = await _llm_map_metrics(metric_names, alias_rows)
    # 允许部分未映射：只对已映射项取数&回填，未映射的保持原样（留空/公式不动）
    # 不再抛 422

    values_map = await _query_financial_metrics(data.company, data.quarters, mapped)
    filled = _fill_sheet_with_values([row[:] for row in data.sheet], data.quarters, mapped, values_map)
    return {"filledSheet": filled, "mapped": mapped}


@app.post("/ai/read-attachment")
async def read_attachment(
    authorization: Optional[str] = Header(None),
    company: str = Form(...),
    quarters: str = Form(...),  # json array
    sheet: str = Form(...),     # json 2d
    file: UploadFile = File(...)
):
    _auth_check(authorization)
    if not OPENAI_KEY:
        raise HTTPException(500, "Server not configured")

    quarters = json.loads(quarters)
    sheet = json.loads(sheet)

    # 读附件到 DataFrame
    content = await file.read()
    df = None
    try:
        if file.filename.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"bad file: {e}")

    # 优先尝试“宽表”解析：第一列为指标名，后续列为 2025Q1/2025Q2...(可带(e))
    rows = []
    qre = re.compile(r'^\s*(20\d{2})Q([1-4])(?:\s*\(e\))?\s*$', re.I)
    quarter_cols = [c for c in df.columns if qre.match(str(c))]
    if quarter_cols:
        # 指标列：包含“指标/指标名/项目”等字样，否则默认第一列
        metric_candidates = [c for c in df.columns if any(k in str(c) for k in ['指标','指标名','项目'])]
        metric_col = metric_candidates[0] if metric_candidates else df.columns[0]
        for _, rowdf in df.iterrows():
            mname = str(rowdf[metric_col]).strip()
            if not mname: 
                continue
            for qc in quarter_cols:
                m = qre.match(str(qc))
                if not m: 
                    continue
                qlabel = f"{m.group(1)}Q{m.group(2)}"
                try:
                    v = float(rowdf[qc])
                except Exception:
                    continue
                rows.append({"metric_name": mname, "company_name": company, "quarter_label": qlabel, "value": v})
    else:
        # 回退到 LLM 解析
        system = "你是结构化抽取助手。识别上传表里的列：metric_name, company_name, quarter_label(如2025Q1), value。只返回 JSON 数组，每个元素为一行。"
        preview = df.head(50).to_dict(orient="records")
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{OPENAI_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={
                    "model": OPENAI_MODEL,
                    "messages":[
                        {"role":"system","content":system},
                        {"role":"user","content":json.dumps({"rows": preview}, ensure_ascii=False)}
                    ],
                    "response_format":{"type":"json_object"}
                }
            )
            r.raise_for_status()
            data_llm = r.json()
            txt = data_llm["choices"][0]["message"]["content"]
        try:
            obj = json.loads(txt)
            rows = obj.get("rows") or obj.get("data") or []
        except Exception as e:
            raise HTTPException(422, f"LLM parse fail: {e}")


    # 拉别名表做对齐
    alias_rows = await _fetch_alias_table()
    amap = _build_canonical_map(alias_rows)

    # 组织为 (canonical_name, quarter) -> value
    values_map = {}
    for r in rows:
        if str(r.get("company_name","")).strip() != company:
            continue
        q = str(r.get("quarter_label","")).strip()
        if q not in quarters:  # 仅回填模板季度
            continue
        m = str(r.get("metric_name","")).strip().lower()
        cn = amap.get(m)
        if not cn:
            # 跳过未知别名，不影响已识别项
            continue

        try:
            v = float(r.get("value"))
        except:
            continue
        values_map[(cn, q)] = v

    # 把识别值回填 sheet（公式不覆盖）
    metric_names = [str(row[0] or "") for row in sheet[1:]]
    # 用 LLM 映射模板侧指标名到 canonical_name（与 read-db 一致）
    mapped = await _llm_map_metrics(metric_names, alias_rows)
    filled = _fill_sheet_with_values([row[:] for row in sheet], quarters, mapped, values_map)
    return {"filledSheet": filled, "mapped": mapped}

