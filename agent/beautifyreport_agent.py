#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Beautify Report Agent
- 输入：经用户确认后的 Markdown 文本 + 可选美化指令（字体、字号、行距、图表配色等）
- 输出：美化后的 HTML（内置 CSS + ECharts 自动渲染）、并上传可下载的 DOCX / PDF（Supabase Storage）
- 鉴权方式、存储桶、可选 LLM 与现有 report_agent 对齐

环境变量（与 report_agent 保持一致）：
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  REPORTS_BUCKET=reports
  REPORT_AGENT_TOKEN=dev-secret-01

  # 可选：如提供则会用 LLM 对 Markdown 做结构润色（不改动事实内容）
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o-mini

  EXPORT_ENABLED=1  # 1=上传 DOCX/PDF/HTML；0=只返回 HTML 字符串
"""

import os, io, uuid, json, datetime as dt, re, logging, traceback
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
import html as html_lib
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
# 可选 LLM
from openai import OpenAI



import matplotlib
matplotlib.use("Agg")           # 无界面环境
from matplotlib import pyplot as plt
# 导出依赖（与 report_agent 保持一致的简单导出策略）
from docx.shared import Pt, Inches
from docx import Document

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

from matplotlib import rcParams
from urllib.parse import quote

from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    ListFlowable, ListItem
)
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT
from reportlab.lib import colors

import html as html_lib  # 如果上面已有就不要重复导入
import re
from typing import Optional

_inline_pat = re.compile(r'(\*\*.+?\*\*|\*.+?\*|`.+?`)', re.U)

def _md_inline_to_rl(text: str, bold_font: str, code_font: Optional[str] = None) -> str:
    """
    将 Markdown 内联格式转成 ReportLab 支持的富文本：
    - **粗体** → <font name="{bold_font}">…</font>
    - *斜体*   → <i>…</i>
    - `代码`   → <font name="{code_font或Courier}">…</font>
    其余文本会做 HTML 转义，避免 & / < / > 破坏结构。
    """
    def esc(s: str) -> str:
        return html_lib.escape(s, quote=False)

    parts: list[str] = []
    for tok in re.split(_inline_pat, text or ""):
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**"):
            parts.append(f'<font name="{bold_font}">{esc(tok[2:-2])}</font>')
        elif tok.startswith("*") and tok.endswith("*"):
            parts.append(f'<i>{esc(tok[1:-1])}</i>')
        elif tok.startswith("`") and tok.endswith("`"):
            cf = code_font or "Courier"
            parts.append(f'<font name="{cf}">{esc(tok[1:-1])}</font>')
        else:
            parts.append(esc(tok))
    return "".join(parts)

def _parse_font_list(families: Optional[str]) -> list[str]:
    """把 CSS 风格的 font-family 转成名字列表，去掉引号和泛型关键字"""
    if not families:
        return []
    raw = [x.strip().strip("'\"") for x in families.split(",")]
    bad = {"sans-serif", "serif", "monospace", "system-ui", "ui-monospace"}
    return [x for x in raw if x and x not in bad]

def _register_ttf_if_exists(path: str, name: str) -> bool:
    try:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
            return True
    except Exception:
        pass
    return False

def _register_family_by_name(name: str) -> tuple[Optional[str], Optional[str]]:
    """
    按常见系统路径尝试注册某个家族的 Regular/Bold。
    返回 (regular_font_name, bold_font_name)；失败返回 (None, None)
    """
    cand: list[tuple[str,str|None,str,str|None]] = []
    # Windows
    cand += [
        ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc", "MSYH", "MSYHBD"),           # Microsoft YaHei
        ("C:/Windows/Fonts/simhei.ttf", None, "SimHei", None),                                     # SimHei（无粗体文件，用同名代替）
        ("C:/Windows/Fonts/simsun.ttc", None, "SimSun", None),
        ("C:/Windows/Fonts/Deng.ttf", "C:/Windows/Fonts/Dengb.ttf", "DengXian", "DengXian-Bold"),
    ]
    # Noto / Linux
    cand += [
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
         "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "NotoSansCJK", "NotoSansCJK-Bold"),
        ("/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
         "/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf", "NotoSansSC", "NotoSansSC-Bold"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "DejaVuSans", "DejaVuSans-Bold"),
    ]

    # 按名称猜测对应文件
    name_low = name.lower()
    matched = []
    if "yahei" in name_low or "microsoft yahei" in name_low:
        matched = [cand[0]]
    elif "simhei" in name_low:
        matched = [cand[1]]
    elif "simsun" in name_low:
        matched = [cand[2]]
    elif "deng" in name_low:
        matched = [cand[3]]
    elif "noto" in name_low:
        matched = [cand[4], cand[5]]
    elif "dejavu" in name_low:
        matched = [cand[6]]
    else:
        matched = cand  # 不认识就全试一遍

    for reg_path, bold_path, rname, bname in matched:
        ok_r = _register_ttf_if_exists(reg_path, rname)
        ok_b = _register_ttf_if_exists(bold_path, bname) if bold_path else False
        if ok_r:
            return (rname, bname if ok_b else rname)
    return (None, None)

def _resolve_pdf_fonts(style) -> tuple[str, str]:
    """
    根据用户设置解析并注册 PDF 用正文字体/粗体；失败时回退到 CID 字体（STSong）。
    """
    # 1) 用户优先：body/heading 任意一个命中即可
    prefs = _parse_font_list(getattr(style, "font_family", None)) \
          + _parse_font_list(getattr(style, "heading_font_family", None))
    for fam in prefs:
        r, b = _register_family_by_name(fam)
        if r:
            return (r, b or r)

    # 2) 回退：尝试系统常见中文字体
    for fam in ["Microsoft YaHei", "Noto Sans SC", "SimHei", "DejaVu Sans"]:
        r, b = _register_family_by_name(fam)
        if r:
            return (r, b or r)

    # 3) 终极回退：CID 字体（中文可见，但无真粗体）
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return ("STSong-Light", "STSong-Light")
    except Exception:
        return ("Helvetica", "Helvetica-Bold")

def _apply_docx_font(doc, family: Optional[str]):
    """让 Word 使用用户字体（若未提供则不强制）"""
    if not family:
        return
    try:
        from docx.oxml.ns import qn
        style = doc.styles["Normal"]
        style.font.name = family
        r = style._element.get_or_add_rPr()
        rFonts = r.rFonts
        rFonts.set(qn('w:ascii'), family)
        rFonts.set(qn('w:eastAsia'), family)
        rFonts.set(qn('w:hAnsi'), family)
        rFonts.set(qn('w:cs'), family)
    except Exception:
        pass


# ✅ Matplotlib 中文与负号
rcParams['font.sans-serif'] = [
    'Microsoft YaHei', 'SimHei', 'Noto Sans CJK SC',
    'Arial Unicode MS', 'DejaVu Sans', 'sans-serif'
]
rcParams['axes.unicode_minus'] = False


logger = logging.getLogger("beautifyreport")
logger.setLevel(logging.INFO)

# ========= 环境 =========
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY", "")
REPORTS_BUCKET = os.getenv("REPORTS_BUCKET", "reports")
REPORT_AGENT_TOKEN = os.getenv("REPORT_AGENT_TOKEN", "dev-secret-01")
EXPORT_ENABLED = os.getenv("EXPORT_ENABLED", "1") == "1"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
if not OPENAI_BASE_URL.endswith("/v1"):
    OPENAI_BASE_URL += "/v1"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY")

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
llm = OpenAI(api_key=OPENAI_API_KEY or None, base_url=OPENAI_BASE_URL)
def ensure_bucket(bucket: str):
    try:
        # 列出已有桶；不存在则创建为 public
        buckets = sb.storage.list_buckets() or []
        names = [ (b.get("name") if isinstance(b, dict) else getattr(b, "name", None)) for b in buckets ]
        if bucket not in names:
            sb.storage.create_bucket(bucket, {"public": True, "file_size_limit": 104857600})
            logger.info("Created storage bucket: %s", bucket)
    except Exception as e:
        logger.warning("ensure_bucket failed: %s", e)

ensure_bucket(REPORTS_BUCKET)

# ========= FastAPI =========
app = FastAPI(title="Beautify Report Agent", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ========= DTO =========
class BeautifyStyle(BaseModel):
    font_family: Optional[str] = 'Inter, "Microsoft YaHei", system-ui, -apple-system, Segoe UI, sans-serif'
    heading_font_family: Optional[str] = None
    code_font_family: Optional[str] = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace'
    base_font_size: Optional[int] = 16                # px
    line_height: Optional[float] = 1.75
    paragraph_spacing_px: Optional[int] = 8           # 段后间距
    content_width_px: Optional[int] = 920
    theme: Optional[str] = "light"                    # light | dark
    color: Optional[str] = "#111827"                  # 正文颜色
    accent_color: Optional[str] = "#2563eb"           # 强调色
    palette: Optional[List[str]] = None               # ECharts 配色数组（如不填则使用默认）

class BeautifyPayload(BaseModel):
    markdown: str
    language: Optional[str] = "zh"
    instructions: Optional[str] = ""                  # 自然语言美化要求（可选）
    style: Optional[BeautifyStyle] = None

# ========= 安全 =========
def auth_check(authorization: Optional[str] = Header(None)):
    if not REPORT_AGENT_TOKEN:
        return True
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    if authorization.split(" ", 1)[1] != REPORT_AGENT_TOKEN:
        raise HTTPException(403, "Invalid token")
    return True

# ========= 工具 =========
ECHARTS_BLOCK_RE = re.compile(r"```echarts\s*([\s\S]*?)```", re.MULTILINE)

# ===== 强化 ECharts 配置：legend/tooltip/中文坐标轴 =====
# --- 1) ECharts 选项增强：留白/图例/坐标轴/中文色彩 ---
def _inject_palette(option: dict, palette: Optional[List[str]], theme: str) -> dict:
    if not isinstance(option, dict):
        return option
    opt = json.loads(json.dumps(option, ensure_ascii=False))  # 深拷贝

    # 主题色
    if palette:
        opt["color"] = palette

    # 图例 + 提示框
    opt.setdefault("legend", {})
    if opt["legend"].get("show") is None:
        opt["legend"]["show"] = True
    opt["legend"].setdefault("top", 6)
    opt["legend"].setdefault("left", "center")
    opt.setdefault("tooltip", {"trigger": "axis"})

    # 网格留白：防止图例/坐标轴把图吃掉
    g = opt.setdefault("grid", {})
    g.setdefault("top", 48)
    g.setdefault("left", 56)
    g.setdefault("right", 32)
    g.setdefault("bottom", 48)
    g.setdefault("containLabel", True)

    # 轴样式（暗色/浅色自适应）
    text_color = "#e5e7eb" if (theme or "light").lower() == "dark" else "#374151"
    axis_line = "#4b5563" if (theme or "light").lower() == "dark" else "#d1d5db"

    def _style_axis(ax):
        if not isinstance(ax, dict):
            return
        ax.setdefault("axisLabel", {}).setdefault("color", text_color)
        ax.setdefault("axisLine", {}).setdefault("lineStyle", {})["color"] = axis_line

    # xAxis/yAxis 可能是对象或数组
    if isinstance(opt.get("xAxis"), list):
        for a in opt["xAxis"]:
            _style_axis(a)
            a.setdefault("boundaryGap", isinstance(opt.get("series"), list) and any(
                (isinstance(s, dict) and (s.get("type") == "bar")) for s in (opt.get("series") or [])
            ))
    elif isinstance(opt.get("xAxis"), dict):
        a = opt["xAxis"]
        _style_axis(a)
        a.setdefault("boundaryGap", isinstance(opt.get("series"), list) and any(
            (isinstance(s, dict) and (s.get("type") == "bar")) for s in (opt.get("series") or [])
        ))

    def _style_yaxis(y):
        if isinstance(y, dict):
            _style_axis(y)
            y.setdefault("type", "value")
            y.setdefault("scale", True)  # ★ 高值时不顶到边

    if isinstance(opt.get("yAxis"), list):
        for y in opt["yAxis"]:
            _style_yaxis(y)
    elif isinstance(opt.get("yAxis"), dict):
        _style_yaxis(opt["yAxis"])
    else:
        opt["yAxis"] = {"type": "value", "scale": True}

    # 自动补 series.name，便于 legend 正常显示
    series = opt.get("series") if isinstance(opt.get("series"), list) else []
    names = []
    for i, s in enumerate(series):
        if isinstance(s, dict) and not s.get("name"):
            s["name"] = f"系列{i+1}"
        if isinstance(s, dict):
            names.append(s.get("name") or f"系列{i+1}")
    if names and not opt["legend"].get("data"):
        opt["legend"]["data"] = names

    # 页面全局文本色
    opt.setdefault("textStyle", {}).setdefault("color", text_color)
    return opt



def normalize_echarts_and_extract(md_text: str, palette: Optional[List[str]], theme: str) -> str:
    """把 ```echarts {...}``` 转成 <div class="echarts" data-option="..."></div>，并做 HTML 转义"""
    def _sub(m):
        raw = m.group(1).strip()
        try:
            obj = json.loads(raw)
        except Exception:
            return m.group(0)  # 原样保留
        obj = _inject_palette(obj, palette, theme)
        dataset = json.dumps(obj, ensure_ascii=False)
        safe = html_lib.escape(dataset, quote=True)  # ★ 关键：转义
        # 用双引号包裹属性，避免被单引号截断
        return f'<div class="echarts" data-option="{safe}" style="height:360px;margin:12px 0;"></div>'
    return ECHARTS_BLOCK_RE.sub(_sub, md_text)


def md_to_html_naive(md: str) -> str:
    """轻量级 Markdown -> HTML（保留换行/列表/标题/加粗/斜体/表格；不依赖额外库）"""
    html = md

    # 代码块（除 echarts 已替换外）
    html = re.sub(r"```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```",
                  lambda m: f'<pre class="code"><code>{m.group(2).replace("<","&lt;").replace(">","&gt;")}</code></pre>',
                  html)

    # 标题
    html = re.sub(r"^### (.*)$", r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r"^## (.*)$",  r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r"^# (.*)$",   r'<h1>\1</h1>', html, flags=re.MULTILINE)

    # 列表
    html = re.sub(r"^\- (.*)$",  r'<li>\1</li>', html, flags=re.MULTILINE)
    html = re.sub(r"^\d+\.\s+(.*)$", r'<li>\1</li>', html, flags=re.MULTILINE)
    # 把连续的 <li> 包成 <ul>/<ol>（简单处理）
    html = re.sub(r"((?:<li>.*?</li>\n?)+)", r"<ul>\1</ul>", html)

    # 粗斜体
    html = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", html)
    html = re.sub(r"\*(.*?)\*",     r"<em>\1</em>", html)

    # 引用
    html = re.sub(r"^> (.*)$", r'<blockquote>\1</blockquote>', html, flags=re.MULTILINE)

    # 表格（超简易）
    def _table(m):
        row = m.group(1)
        cells = [f"<td>{c.strip()}</td>" for c in row.split("|")]
        return "<tr>" + "".join(cells) + "</tr>"
    html = re.sub(r"^\|(.*?)\|$", _table, html, flags=re.MULTILINE)
    html = re.sub(r"((?:<tr>.*?</tr>\n?)+)", r'<table class="table">\1</table>', html)

    # 换行
    html = html.replace("\n", "<br />")
    return html
def _slug_id(text: str) -> str:
    # 允许中文作为 id，去掉空白与特殊符号；前缀 sec-
    t = re.sub(r"<.*?>", "", text or "")
    t = re.sub(r"\s+", "-", t.strip())
    t = re.sub(r"[^\w\-\u4e00-\u9fff]", "", t)  # 保留中英数/下划线/连字符/中文
    return "sec-" + (t or "section")

def _wrap_section(html: str, sec_id: str, tone: str) -> str:
    # 把指定 id 的 <h2>…</h2> 到下一个 <h2> 前的内容包到卡片里
    pat = re.compile(rf'(<h2 id="{re.escape(sec_id)}"[^>]*>.*?</h2>)(.*?)(?=<h2 id=|$)', re.S)
    def repl(m):
        return f'<section class="card {tone}">' + m.group(1) + m.group(2) + '</section>'
    return pat.sub(repl, html, count=1)

# --- 2) 给 h2/h3 加 id；侧边栏；仅“总起/摘要”做卡片；风险段落粗体变红 ---
def apply_layout_cards_and_toc(inner_html: str, theme: str = "light") -> str:
    html = inner_html

    # 给 h2/h3 加 id，并采集目录
    heads = []
    def add_id(m):
        tag, txt = m.group(1), m.group(2)
        sid = _slug_id(txt)
        heads.append((tag, sid, txt))
        return f'<{tag} id="{sid}">{txt}</{tag}>'
    html = re.sub(r"<(h2|h3)>(.*?)</\1>", add_id, html, flags=re.S)

    # 仅“摘要/总起/总述”包成卡片；风险章节不包卡片，但给 class 方便样式定点强化
    def _wrap_once(sec_id: str, cls: str):
        pat = re.compile(rf'(<h2 id="{re.escape(sec_id)}"[^>]*>.*?</h2>)(.*?)(?=<h2 id=|$)', re.S)
        def repl(m):
            return f'<section class="{cls}">' + m.group(1) + m.group(2) + '</section>'
        return pat.sub(repl, html, count=1)

    for tag, sid, txt in heads:
        if tag != "h2":
            continue
        t = str(txt)
        if any(k in t for k in ["摘要", "总起", "总述"]):
            html = _wrap_once(sid, "card tone-blue")
        elif any(k in t for k in ["风险", "风险点", "风控"]):
            # 只加 class，不加背景
            html = _wrap_once(sid, "risk")

    # 侧边栏目录（只列 h2）
    if heads:
        toc = ["<div class='title'>报告目录</div>"]
        for tag, sid, txt in heads:
            if tag == "h2":
                toc.append(f"<a href='#{sid}'>{html_lib.escape(txt)}</a>")
        toc_html = "<nav>" + "\n".join(toc) + "</nav>"
        html = f"<div class='layout'><aside class='sidebar'>{toc_html}</aside><article>{html}</article></div>"

    return html

# ===== HTML 生成：使用外链 echarts + 内联渲染脚本；支持下载 =====
# --- 3) 页面样式与脚手架：更强的 H1；仅摘要卡片带浅底；风险段落粗体=红字；KPI 宫格可选 ---
def build_html_document(body_inner: str, style: BeautifyStyle) -> str:
    font  = style.font_family or 'Inter, "Microsoft YaHei", system-ui, sans-serif'
    hfont = style.heading_font_family or font
    cfont = style.code_font_family or 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace'
    fs    = style.base_font_size or 16
    lh    = style.line_height or 1.75
    gap   = style.paragraph_spacing_px or 8
    width = style.content_width_px or 920
    theme = (style.theme or "light").lower()
    color = style.color or "#111827"
    accent = style.accent_color or "#2563eb"

    bg = "#0b1220" if theme == "dark" else "#ffffff"
    subtle_border = "rgba(255,255,255,.14)" if theme == "dark" else "rgba(0,0,0,.10)"
    subtle_bg     = "rgba(255,255,255,.06)" if theme == "dark" else "rgba(37,99,235,.06)"  # 仅摘要卡片会用
    muted_text    = "#9ca3af" if theme == "dark" else "#6b7280"
    card_shadow   = "0 8px 20px rgba(0,0,0,.35)" if theme == "dark" else "0 8px 20px rgba(0,0,0,.06)"

    css = f"""
    :root {{
      --font: {font};
      --hfont: {hfont};
      --cfont: {cfont};
      --fs: {fs}px;
      --lh: {lh};
      --gap: {gap}px;
      --w: {width}px;
      --fg: {color};
      --bg: {bg};
      --accent: {accent};
      --muted: {muted_text};
      --border: {subtle_border};
      --subtle-blue: {subtle_bg};
      --shadow: {card_shadow};
    }}
    * {{ box-sizing: border-box; }}
    html,body {{ height: 100%; }}
    body {{
      margin: 0; padding: 24px; color: var(--fg); background: var(--bg);
      font-family: var(--font); font-size: var(--fs); line-height: var(--lh);
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }}
    .container {{ max-width: var(--w); margin: 0 auto; }}

    /* —— 标题 —— */
    h1,h2,h3,h4,h5,h6 {{ font-family: var(--hfont); margin: 1.2em 0 .6em; line-height: 1.25; }}
    h1.hero {{
      font-size: calc(var(--fs) * 2.4);
      font-weight: 800;
      letter-spacing: .3px;
      margin-top: 6px;
      position: relative;
      padding-bottom: .25em;
    }}
    h1.hero::after {{
      content: ""; position: absolute; left: 0; bottom: 0; height: 4px; width: 82px;
      background: linear-gradient(90deg, var(--accent), transparent);
      border-radius: 8px;
    }}
    h2 {{ font-size: calc(var(--fs) * 1.6); border-left: 4px solid var(--accent); padding-left: .55em; }}
    h3 {{ font-size: calc(var(--fs) * 1.3); }}

    p, ul, ol, blockquote, table, pre {{ margin: var(--gap) 0; }}
    ul, ol {{ padding-left: 1.2em; }}
    strong {{ font-weight: 600; }}
    em {{ font-style: italic; }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}

    /* —— 引用/代码/表格 —— */
    blockquote {{ padding: .7em 1em; background: rgba(0,0,0,.04); border-left: 3px solid var(--accent); border-radius: 8px; }}
    pre, code {{ font-family: var(--cfont); }}
    pre.code {{ background: rgba(0,0,0,.05); padding: 12px; border-radius: 10px; overflow:auto; }}
    table.table {{ width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }}
    table.table th, table.table td {{ border-bottom: 1px solid var(--border); padding: 10px 12px; }}
    table.table thead th {{ background: rgba(0,0,0,.03); text-align: left; }}

    /* —— 卡片（仅用于“摘要/总起”） —— */
    .card {{
      padding: 16px 18px; border: 1px solid var(--border); border-radius: 12px;
      box-shadow: var(--shadow); margin: 12px 0;
      background: transparent;
    }}
    .card.tone-blue {{ background: var(--subtle-blue); border-color: rgba(37,99,235,.28); }}

    /* 风险章节：段内粗体高亮为红色 */
    .risk strong {{ color: #ef4444; }}

    /* KPI 宫格（可选使用） */
    .kpi-grid {{ display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 12px 0; }}
    .kpi {{ padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: transparent; }}
    .kpi .label {{ font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }}
    .kpi .value {{ font-size: 20px; font-weight: 700; margin-top: 2px; color: var(--fg); }}
    .kpi .icon {{ font-size: 14px; }}
    @media (max-width: 1024px) {{ .kpi-grid {{ grid-template-columns: repeat(2, minmax(0,1fr)); }} }}

    /* 两栏布局 + 侧栏 */
    .layout {{ display: grid; grid-template-columns: 260px 1fr; gap: 24px; }}
    .sidebar {{
      position: sticky; top: 16px; align-self: start; color: var(--muted);
      border-left: 3px solid var(--accent); padding-left: 12px; max-height: calc(100vh - 80px); overflow:auto;
    }}
    .sidebar nav a {{ display:block; padding:6px 0; color:var(--muted); text-decoration:none; }}
    .sidebar nav a:hover {{ color: var(--fg); }}
    .sidebar .title {{ font-weight:600; color:var(--fg); margin-bottom:6px; }}
    @media (max-width: 1100px) {{ .layout {{ grid-template-columns: 1fr; }} .sidebar {{ position: relative; max-height:none; }} }}

    /* 图表容器 */
    .echarts {{
      width: 100%; height: 360px; border: 1px solid var(--border); border-radius: 10px; margin: 12px 0;
      background: transparent;
    }}

    .footer {{ color: var(--muted); font-size: 12px; margin-top: 32px; text-align: right; }}
    """

    # 强化 H1：把第一处 <h1> 加 hero class
    body_inner = re.sub(r"<h1>(.*?)</h1>", r'<h1 class="hero">\1</h1>', body_inner, count=1)

    echarts_script = '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js" defer></script>'
    js = """
    document.addEventListener('DOMContentLoaded', function(){
      if(!window.echarts) return;
      var nodes = document.querySelectorAll('.echarts');
      nodes.forEach(function(div){
        try{
          var raw = div.getAttribute('data-option') || '{}';
          var opt = JSON.parse(raw);
          var chart = echarts.init(div);
          chart.setOption(opt || {});
          // 初次和窗口变化都强制 resize，避免容器首次计算不完整
          setTimeout(function(){ chart.resize(); }, 30);
          window.addEventListener('resize', function(){ chart && chart.resize(); });
        }catch(e){ console.warn('echarts parse failed', e); }
      });
    });
    """

    html = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'">
<title>Beautified Report</title>
<style>{css}</style>
{echarts_script}
</head>
<body>
  <main class="container">
    {body_inner}
    <div class="footer">由 Beautify Report Agent 生成</div>
  </main>
<script>{js}</script>
</body>
</html>
"""
    return html





# --- 改后（整段替换） ---
# ===== 上传：确保 contentType 为字符串，并返回可访问链接 =====
def _upload(path: str, content: bytes, content_type: str) -> str:
    sb.storage.from_(REPORTS_BUCKET).upload(
        path, content, {"contentType": str(content_type), "upsert": "true"}
    )
    return sb.storage.from_(REPORTS_BUCKET).get_public_url(path)

def _make_download_url(path: str, public_url: str, filename: str) -> str:
    """
    优先用 Supabase 的 create_signed_url(download=filename) 生成带 attachment 的链接；
    失败时回退为 public_url?download=filename
    """
    try:
        # supabase-py v2 返回 {'signed_url': '...'} 或 {'data': {'signed_url': '...'}}
        resp = sb.storage.from_(REPORTS_BUCKET).create_signed_url(
            path, 60 * 60 * 24,  # 24h 有效
            {"download": filename}
        )
        if isinstance(resp, dict):
            signed = resp.get("signed_url") or resp.get("signedURL")
            if not signed and "data" in resp and isinstance(resp["data"], dict):
                signed = resp["data"].get("signed_url") or resp["data"].get("signedURL")
            if signed:
                return signed
    except Exception as e:
        logger.warning("create_signed_url failed: %s", e)
    # 兜底：公有桶也支持 ?download= 文件名
    sep = "&" if "?" in public_url else "?"
    return f"{public_url}{sep}download={quote(filename)}"




# ===== 把 ECharts 渲成 PNG（供 DOCX/PDF 使用），保证中文 =====
def _render_chart_png(opt: dict, style: BeautifyStyle) -> bytes:
    """
    用 matplotlib 近似渲染 ECharts（支持 line/bar），并优先使用用户字体。
    """
    try:
        # ★ 用户字体优先
        fams = _parse_font_list(getattr(style, "font_family", None))
        if fams:
            rcParams['font.sans-serif'] = fams + rcParams.get('font.sans-serif', [])
        rcParams['axes.unicode_minus'] = False

        x_data = []
        if isinstance(opt.get("xAxis"), dict):
            x_data = opt["xAxis"].get("data") or []
        series = opt.get("series") if isinstance(opt.get("series"), list) else []
        if not x_data or not series:
            return b""

        palette = opt.get("color") or (style.palette or
                   ["#2563eb","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4"])
        fig = plt.figure(figsize=(7.2, 4.2), dpi=160)
        ax = fig.gca()
        x_idx = list(range(len(x_data)))

        only_bar = all((s.get("type") == "bar") for s in series if isinstance(s, dict))
        for i, s in enumerate(series):
            y = s.get("data") or []
            name = s.get("name") or f"系列{i+1}"
            typ = s.get("type") or ("bar" if only_bar else "line")
            color = palette[i % len(palette)]
            if typ == "bar":
                n = len(series); width = 0.8 / max(1, n)
                ax.bar([t + (i - (n-1)/2)*width for t in x_idx], y, width=width, label=name, color=color)
            else:
                ax.plot(x_idx, y, marker='o', label=name, color=color)

        ax.set_xticks(x_idx)
        ax.set_xticklabels([str(x) for x in x_data], rotation=30, ha='right')
        ax.grid(True, linestyle='--', alpha=0.25)
        if isinstance(opt.get("title"), dict):
            t = opt["title"].get("text") or ""
            if t: ax.set_title(t)
        ax.legend()

        buf = io.BytesIO()
        plt.tight_layout()
        fig.savefig(buf, format="png")
        plt.close(fig)
        return buf.getvalue()
    except Exception:
        return b""


def _px_to_pt(px: int) -> Pt:
    return Pt(max(8, (px or 16) * 0.75))
INLINE_RE = re.compile(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)')
def _add_md_line(doc: Document, text: str, style: BeautifyStyle, bullet: bool = False):
    p = doc.add_paragraph(style="List Bullet") if bullet else doc.add_paragraph()
    if style.paragraph_spacing_px:
        p.paragraph_format.space_after = _px_to_pt(style.paragraph_spacing_px)

    for token in re.split(INLINE_RE, text):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**"):
            run = p.add_run(token[2:-2]); run.bold = True
        elif token.startswith("*") and token.endswith("*"):
            run = p.add_run(token[1:-1]); run.italic = True
        elif token.startswith("`") and token.endswith("`"):
            run = p.add_run(token[1:-1]); run.font.name = (style.code_font_family or "Consolas")
        else:
            p.add_run(token)



def _iter_md_segments(md_text: str):
    pos = 0
    for m in ECHARTS_BLOCK_RE.finditer(md_text):
        if m.start() > pos:
            yield ("text", md_text[pos:m.start()])
        raw = (m.group(1) or "").strip()
        try:
            opt = json.loads(raw)
        except Exception:
            opt = None
        yield ("echarts", opt)
        pos = m.end()
    if pos < len(md_text):
        yield ("text", md_text[pos:])

def export_docx_from_md(md_text: str, style: BeautifyStyle) -> bytes:
    doc = Document()
    normal = doc.styles["Normal"]
    if style.base_font_size:
        normal.font.size = _px_to_pt(style.base_font_size)
    _apply_docx_font(doc, getattr(style, "font_family", None)) 


    for kind, payload in _iter_md_segments(md_text):
        if kind == "text":
            for raw in (payload or "").splitlines():
                line = raw.strip("\r")
                if line.startswith("# "):
                    doc.add_heading(line[2:].strip(), 0)
                elif line.startswith("## "):
                    doc.add_heading(line[3:].strip(), 1)
                elif line.startswith("### "):
                    doc.add_heading(line[4:].strip(), 2)
                elif line.startswith("- "):
                    _add_md_line(doc, line[2:].strip(), style, bullet=True)
                else:
                    _add_md_line(doc, line, style)
        else:
            opt = _inject_palette(payload or {}, style.palette, style.theme)
            png = _render_chart_png(opt, style)
            if png:
                doc.add_picture(io.BytesIO(png), width=Inches(6.2))
            else:
                _add_md_line(doc, "```echarts ...```", style)

    buf = io.BytesIO(); doc.save(buf); return buf.getvalue()

def export_pdf_from_md(md_text: str, style: BeautifyStyle) -> bytes:
    """用 ReportLab Platypus：自动换行/真正粗体/标题/列表/图表 PNG 嵌入。"""
    base_font, bold_font = _resolve_pdf_fonts(style)
    fs = max(12, int((style.base_font_size or 16)))
    leading = int(fs * (style.line_height or 1.6))
    gap = (style.paragraph_spacing_px or 8)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm
    )

    styles = getSampleStyleSheet()

    # ✅ 安全创建/更新样式（避免与内置同名样式冲突）
    def ensure_style(name: str, **kwargs) -> ParagraphStyle:
        if name in styles.byName:
            s = styles[name]
            for k, v in kwargs.items():
                setattr(s, k, v)
            return s
        s = ParagraphStyle(name=name, **kwargs)
        styles.add(s)
        return s

    ensure_style("Body",
                 fontName=base_font, fontSize=fs, leading=leading,
                 spaceAfter=gap, alignment=TA_LEFT)
    ensure_style("H1",
                 parent=styles["Heading1"], fontName=bold_font,
                 fontSize=int(fs*1.6), leading=int(leading*1.1), spaceAfter=gap+2)
    ensure_style("H2",
                 parent=styles["Heading2"], fontName=bold_font,
                 fontSize=int(fs*1.35), leading=int(leading*1.05), spaceAfter=gap)
    ensure_style("H3",
                 parent=styles["Heading3"], fontName=bold_font,
                 fontSize=int(fs*1.15), leading=int(leading), spaceAfter=gap-2)
    # ⚠️ 不要再添加 name="Bullet" 的样式；内置样式中已经有 Bullet

    flow, bullets = [], []

    def flush_bullets():
        if not bullets:
            return
        items = [
            ListItem(Paragraph(_md_inline_to_rl(t, bold_font), styles["Body"]))
            for t in bullets
        ]
        flow.append(ListFlowable(items, bulletType='bullet', start='•', leftIndent=10*mm))
        flow.append(Spacer(1, gap))
        bullets.clear()

    for kind, payload in _iter_md_segments(md_text):
        if kind == "text":
            for raw in (payload or "").splitlines():
                line = raw.rstrip("\r")
                if not line.strip():
                    flush_bullets()
                    flow.append(Spacer(1, gap//2))
                    continue
                if line.startswith("# "):
                    flush_bullets()
                    flow.append(Paragraph(_md_inline_to_rl(line[2:].strip(), bold_font), styles["H1"]))
                elif line.startswith("## "):
                    flush_bullets()
                    flow.append(Paragraph(_md_inline_to_rl(line[3:].strip(), bold_font), styles["H2"]))
                elif line.startswith("### "):
                    flush_bullets()
                    flow.append(Paragraph(_md_inline_to_rl(line[4:].strip(), bold_font), styles["H3"]))
                elif line.startswith("- "):
                    bullets.append(line[2:].strip())
                else:
                    flush_bullets()
                    flow.append(Paragraph(_md_inline_to_rl(line, bold_font), styles["Body"]))
            flush_bullets()
        else:
            opt = _inject_palette(payload or {}, style.palette, style.theme)
            png = _render_chart_png(opt, style)
            if png:
                img = RLImage(io.BytesIO(png))
                max_w = doc.width
                iw, ih = img.drawWidth, img.drawHeight
                scale = min(1.0, max_w / iw)
                img.drawWidth, img.drawHeight = iw*scale, ih*scale
                flush_bullets()
                flow.append(img)
                flow.append(Spacer(1, gap))
            else:
                flush_bullets()
                flow.append(Paragraph('[图表渲染失败，已保留为代码]', styles["Body"]))

    doc.build(flow)
    return buf.getvalue()


SYSTEM_PROMPT = (
    "你是【报告排版/美化专家】。你的任务是：在不改动事实和数据的前提下，"
    "把我给你的 Markdown 排成一个**结构清晰、带侧边栏目录、卡片化信息块**的 HTML+Markdown 混合文档。"
    "\n\n【必须遵守】\n"
    "1) **严禁改数据/结论**，只做结构与呈现优化；中文用词保持中性客观。\n"
    "2) **禁止** 引入外部 CSS/JS/框架（例如 Tailwind/Bootstrap/FontAwesome/Chart.js 等）；"
    "   只可输出少量语义化 HTML 容器标签（section/div/aside/nav/span）。\n"
    "3) **图表** 必须保留为 ```echarts {…}``` 代码块（不要改成别的库）；标题下方可补一行图注："
    "   <div class='caption'>说明</div>。\n"
    "4) **表格** 使用 Markdown 表格（第一行是表头），不要手写 <table>。"
    "   粗体/斜体/行内代码继续用 Markdown 语法（**…** / *…* / `…`）。\n"
    "5) **字体** 完全遵循用户设置（不要硬编码字体名称/字号/行距）。\n"
    "\n【页面骨架（请照这个结构组织内容）】\n"
    "== 顶部标题区 ==\n"
    "- 顶部 H1：完整报告标题（例如《XX公司年度财务报告》）。\n"
    "- H1 下给 1~3 行关键信息（时间范围/公司名/报告语言等），用 <span class='tag'>…</span> 包装关键字段。\n"
    "\n"
    "== 主体两栏布局 ==\n"
    "<div class='layout'>\n"
    "  <aside class='sidebar'>\n"
    "    <nav>\n"
    "      <div class='title'>报告目录</div>\n"
    "      <!-- 目录项：锚点链接指向正文标题 id -->\n"
    "      <a href='#sec-摘要'>摘要</a>\n"
    "      <a href='#sec-核心指标'>核心指标</a>\n"
    "      <a href='#sec-分项分析'>分项分析</a>\n"
    "      <a href='#sec-风险与建议'>风险与建议</a>\n"
    "    </nav>\n"
    "    <!-- 可选：关键统计/重点关注列表，使用 .tag 小标签或简短说明 -->\n"
    "  </aside>\n"
    "  <article>\n"
    "    \n"
    "    <!-- 1) 摘要卡片：用 tone-blue/green/red 区分类型 -->\n"
    "    <section id='sec-摘要' class='card tone-blue'>\n"
    "      <h2>摘要</h2>\n"
    "      <!-- 将原始摘要要点合并为条理清晰的段落或列表（不改事实） -->\n"
    "      - 关键结论 1\n"
    "      - 关键结论 2\n"
    "    </section>\n"
    "\n"
    "    <!-- 2) KPI 宫格（若原文有核心指标） -->\n"
    "    <section id='sec-核心指标'>\n"
    "      <h2>核心指标</h2>\n"
    "      <div class='kpi-grid'>\n"
    "        <div class='kpi'>\n"
    "          <div class='label'>利润总额</div>\n"
    "          <div class='value'>**123.4 亿元**</div>\n"
    "          <div class='delta'>同比 +x.xx%</div>\n"
    "        </div>\n"
    "        <!-- 其余 KPI ... -->\n"
    "      </div>\n"
    "    </section>\n"
    "\n"
    "    <!-- 3) 分项分析：每一小节都要有 h2/h3（带 id），图表用 ```echarts```，并加图注 -->\n"
    "    <section id='sec-分项分析'>\n"
    "      <h2>分项分析</h2>\n"
    "      <h3 id='sec-盈利能力'>盈利能力</h3>\n"
    "      ```echarts\n"
    "      { \"title\": {\"text\": \"ROA/ROE 趋势\"}, \"legend\": {}, \"xAxis\": {\"data\": [\"2024Q1\",\"2024Q2\"]},\n"
    "        \"yAxis\": {}, \"series\": [ {\"type\":\"line\",\"name\":\"ROA\",\"data\":[0.12,0.13]},\n"
    "                                   {\"type\":\"line\",\"name\":\"ROE\",\"data\":[0.15,0.16]} ] }\n"
    "      ```\n"
    "      <div class='caption'>ROA/ROE 季度变化</div>\n"
    "      \n"
    "      <!-- 如有多组：营运能力、现金流、风险指标等，每组都同样结构 -->\n"
    "    </section>\n"
    "\n"
    "    <!-- 4) 风险与建议：用不同色调卡片突出 -->\n"
    "    <section id='sec-风险与建议' class='card tone-red'>\n"
    "      <h2>风险与建议</h2>\n"
    "      - 主要风险 1（原因/表现）\n"
    "      - 主要风险 2（原因/表现）\n"
    "    </section>\n"
    "\n"
    "  </article>\n"
    "</div>\n"
    "\n【排版细节】\n"
    "- 所有二级/三级标题都要**带 id**（如 #sec-盈利能力），目录锚点链接要准确指向。\n"
    "- 图表标题简洁，legend 必须开启；图注一句话说明图表代表的含义。\n"
    "- 如果原文含有“重点结论/异常项/提示”，优先用 <section class='card tone-red|green|blue'> 表示；\n"
    "- 如果没有侧边栏所需的信息，也请**至少**输出一个包含二级标题链接的目录。\n"
    "- 不要输出 <html> / <head> / <body> 外层骨架，保持为 Markdown + 少量容器 HTML。\n"
)



@app.get("/health")
def health():
    return {"ok": True, "time": dt.datetime.utcnow().isoformat()}

@app.post("/beautify/run")
def beautify_run(payload: BeautifyPayload, _=Depends(auth_check)):
    try:
        style = payload.style or BeautifyStyle()
        md = payload.markdown or ""
        if not md.strip():
            raise HTTPException(400, "空的 markdown")

        # 1) （可选）LLM轻度排版润色——不改事实
        improved_md = md
        if OPENAI_API_KEY and (payload.instructions or "").strip():
            try:
                msgs = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps({
                        "markdown": md,
                        "instructions": payload.instructions
                    }, ensure_ascii=False)}
                ]
                resp = llm.chat.completions.create(
                    model=OPENAI_MODEL, messages=msgs, temperature=0.1, max_tokens=4096
                )
                improved_md = resp.choices[0].message.content or md
            except Exception as e:
                logger.warning("LLM beautify skipped: %s", e)
                improved_md = md

        # 2) HTML：把 ```echarts``` 替换成 <div class="echarts" ...> 再包裹页面
        md_with_div = normalize_echarts_and_extract(improved_md, style.palette, style.theme)
        body_html = md_to_html_naive(md_with_div)
        # ★★ 新增：无论是否使用 LLM，都做结构增强（侧边栏 + 卡片）
        body_html = apply_layout_cards_and_toc(body_html, style.theme or "light")
        html_doc = build_html_document(body_html, style)


        # 3) 导出/上传
        job_id = str(uuid.uuid4())
        day = dt.datetime.utcnow().strftime("%Y%m%d")
        base_path = f"{day}/{job_id}"

        result = {
            "job_id": job_id,
            "generated_at": dt.datetime.utcnow().isoformat(),
            "html": html_doc if not EXPORT_ENABLED else None
        }

        if EXPORT_ENABLED:
            # 3.1 先生成三个文件的 bytes
            #    DOCX/PDF 用 improved_md（保留 ```echarts```，我会把图转 PNG 后嵌入）
            docx_bytes = export_docx_from_md(improved_md, style)
            pdf_bytes  = export_pdf_from_md(improved_md, style)
            html_bytes = html_doc.encode("utf-8")

            # 3.2 上传
            # HTML
            html_path = f"{base_path}/beautified.html"
            html_url = _upload(html_path, html_bytes, "text/html; charset=utf-8")
            html_dl  = _make_download_url(html_path, html_url, "beautified.html")

            # DOCX
            docx_path = f"{base_path}/beautified.docx"
            docx_url = _upload(
                docx_path,
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            )
            docx_dl  = _make_download_url(docx_path, docx_url, "beautified.docx")

            # PDF
            pdf_path = f"{base_path}/beautified.pdf"
            pdf_url = _upload(pdf_path, pdf_bytes, "application/pdf")
            pdf_dl  = _make_download_url(pdf_path, pdf_url, "beautified.pdf")

            result.update({
                "html_url": html_url,
                "html_download_url": html_dl,
                "docx_url": docx_url,
                "docx_download_url": docx_dl,
                "pdf_url": pdf_url,
                "pdf_download_url": pdf_dl,
                "file_name": "beautified_report"
            })

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("beautify failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(500, f"beautify failed: {e}")
