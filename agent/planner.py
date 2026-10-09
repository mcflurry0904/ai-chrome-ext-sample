"""把中文口令规划成页面操作。模型调用走 LangChain 的 ChatOpenAI。"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import urlparse

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

# Doubao-Seed-2.0-lite 在火山方舟上的模型 ID。
# 用 VOLCENGINE_API_KEY 请求 https://ark.cn-beijing.volces.com/api/v3/chat/completions 核对过：
# doubao-seed-2-0-lite-260215、doubao-seed-2.0-lite 返回 InvalidEndpointOrModel.NotFound，
# doubao-seed-2-0-lite-260428 可以正常返回内容。可用 VOLCENGINE_MODEL 覆盖。
DEFAULT_MODEL_ID = "doubao-seed-2-0-lite-260428"
DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# 与车辆系统页面的车牌校验一致：一个汉字、一个字母、五位字母或数字。
PLATE_RE = re.compile(r"^[\u4e00-\u9fff][A-Z][A-Z0-9]{5}$")
ROW_SELECTOR = re.compile(
    r'^button\[data-action="(edit|delete)"\]\[data-plate="([\u4e00-\u9fff][A-Z][A-Z0-9]{5})"\]$'
)

# 模型只能点这些控件。白名单避免它编出页面上不存在的选择器。
CLICKABLE = {
    "#btn-search",
    "#btn-reset",
    "#btn-add",
    "#btn-delete-filtered",
    "#btn-restore",
    "#btn-save",
    "#btn-cancel",
    "#btn-confirm-ok",
    "#btn-confirm-cancel",
}
FILLABLE = {
    "#filter-date-from",
    "#filter-date-to",
    "#filter-plate",
    "#form-plate",
    "#form-driver",
    "#form-date",
}
SELECT_VALUES = {
    "#filter-status": {"全部", "在途", "空闲", "维修中"},
    "#form-type": {"货车", "客车", "轿车"},
    "#form-status": {"在途", "空闲", "维修中"},
}
# 这两步会弹出确认框，后面必须再点确定。单行删除由选择器单独判断。
DESTRUCTIVE_CLICKS = {"#btn-delete-filtered", "#btn-restore"}


class PlanError(ValueError):
    pass


class Action(BaseModel):
    """插件用 playwright-crx 执行的一步。selector 是页面上的 CSS 选择器。"""

    op: Literal["goto", "click", "fill", "select", "press"]
    selector: str = ""
    value: str = ""


class Plan(BaseModel):
    reply: str = Field(min_length=1)
    actions: list[Action] = Field(default_factory=list)


def resolve_dates(today: str, yesterday: str) -> tuple[str, str]:
    """优先用插件传来的日期，这样和车辆页面用本地日历算出的“昨天”一致。"""
    if DATE_RE.match(today) and DATE_RE.match(yesterday):
        return today, yesterday
    now = datetime.now()
    previous = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d"), previous.strftime("%Y-%m-%d")


def message_text(message) -> str:
    """豆包有时把正文放在字符串里，有时放在 type=text 的内容块里。"""
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "\n".join(parts)
    return str(content)


def parse_plan(raw: str) -> Plan:
    """从模型原文里取出 JSON。模型偶尔会包一层 Markdown 代码块。"""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise PlanError("模型没有返回 JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise PlanError(f"JSON 无法解析：{exc.msg}") from exc
    try:
        return Plan.model_validate(data)
    except Exception as exc:
        raise PlanError("JSON 缺少 reply 或 actions") from exc


def _is_destructive(selector: str) -> bool:
    if selector in DESTRUCTIVE_CLICKS:
        return True
    match = ROW_SELECTOR.match(selector)
    return bool(match and match.group(1) == "delete")


def _check_selector_click(selector: str, index: int) -> None:
    if selector in CLICKABLE or ROW_SELECTOR.match(selector):
        return
    raise PlanError(
        f"第 {index} 步不能点击 {selector}。"
        '行内按钮请写成 button[data-action="edit"][data-plate="京A10293"]'
    )


def _check_action(action: Action, index: int, system_url: str) -> Action:
    selector = action.selector.strip()
    value = action.value.strip()
    if action.op == "goto":
        target = urlparse(value)
        system = urlparse(system_url)
        if target.scheme not in {"http", "https"} or target.hostname not in {"127.0.0.1", "localhost"}:
            raise PlanError(f"第 {index} 步只能打开本机车辆系统")
        if system.hostname and target.netloc != system.netloc:
            raise PlanError(f"第 {index} 步的地址必须是 {system_url}")
        return Action(op="goto", selector="", value=value)
    if action.op == "click":
        _check_selector_click(selector, index)
        return Action(op="click", selector=selector, value="")
    if action.op == "fill":
        if selector not in FILLABLE:
            raise PlanError(f"第 {index} 步不能填写 {selector}")
        if selector in {"#filter-date-from", "#filter-date-to", "#form-date"} and value and not DATE_RE.match(value):
            raise PlanError(f"第 {index} 步日期要写成 YYYY-MM-DD")
        if selector == "#form-plate" and not PLATE_RE.match(value.upper()):
            raise PlanError(f"第 {index} 步车牌要类似京A10293")
        if selector == "#form-driver" and not value:
            raise PlanError(f"第 {index} 步司机不能为空")
        if len(value) > 32:
            raise PlanError(f"第 {index} 步填入内容过长")
        if selector in {"#form-plate", "#filter-plate"}:
            value = value.upper()
        return Action(op="fill", selector=selector, value=value)
    if action.op == "select":
        allowed = SELECT_VALUES.get(selector)
        if not allowed or value not in allowed:
            names = "、".join(sorted(allowed or [])) or "无"
            raise PlanError(f"第 {index} 步在 {selector} 上只能选择：{names}")
        return Action(op="select", selector=selector, value=value)
    if action.op == "press":
        if selector not in FILLABLE or value not in {"Enter", "Tab"}:
            raise PlanError(f"第 {index} 步只允许在输入框按 Enter 或 Tab")
        return Action(op="press", selector=selector, value=value)
    raise PlanError(f"第 {index} 步使用了不支持的操作")


def prepare(plan: Plan, system_url: str) -> Plan:
    """校验每一步，并补上模型漏掉的确认点击。

    插件自己会打开车辆系统，所以指向本机系统的 goto 会被丢掉。
    删除和恢复初始数据都会弹出确认框；如果下一步还不是确定，就补上。
    """
    if len(plan.actions) > 8:
        raise PlanError("操作超过 8 步，请拆短")
    checked = [_check_action(action, index, system_url) for index, action in enumerate(plan.actions, start=1)]
    checked = [action for action in checked if action.op != "goto"]
    folded: list[Action] = []
    for index, action in enumerate(checked):
        folded.append(action)
        upcoming = checked[index + 1] if index + 1 < len(checked) else None
        already = upcoming and upcoming.op == "click" and upcoming.selector == "#btn-confirm-ok"
        if action.op == "click" and _is_destructive(action.selector) and not already:
            folded.append(Action(op="click", selector="#btn-confirm-ok", value=""))
    reply = plan.reply.strip()[:200] or "已安排页面操作"
    return Plan(reply=reply, actions=folded)


def system_prompt(today: str, yesterday: str) -> str:
    """把页面控件和两个示例写进系统提示。示例里的日期用调用时的昨天，避免模型自己算错。"""
    delete_yesterday = {
        "reply": f"筛选 {yesterday} 的车辆并删除这些记录。",
        "actions": [
            {"op": "fill", "selector": "#filter-date-from", "value": yesterday},
            {"op": "fill", "selector": "#filter-date-to", "value": yesterday},
            {"op": "fill", "selector": "#filter-plate", "value": ""},
            {"op": "select", "selector": "#filter-status", "value": "全部"},
            {"op": "click", "selector": "#btn-search"},
            {"op": "click", "selector": "#btn-delete-filtered"},
            {"op": "click", "selector": "#btn-confirm-ok"},
        ],
    }
    edit_one = {
        "reply": "把苏E33058的状态改为维修中。",
        "actions": [
            {"op": "fill", "selector": "#filter-plate", "value": "苏E33058"},
            {"op": "fill", "selector": "#filter-date-from", "value": ""},
            {"op": "fill", "selector": "#filter-date-to", "value": ""},
            {"op": "select", "selector": "#filter-status", "value": "全部"},
            {"op": "click", "selector": "#btn-search"},
            {"op": "click", "selector": 'button[data-action="edit"][data-plate="苏E33058"]'},
            {"op": "select", "selector": "#form-status", "value": "维修中"},
            {"op": "click", "selector": "#btn-save"},
        ],
    }
    return f"""你是某某车辆实时管理系统的操作规划器。只输出一个 JSON 对象，不要 Markdown。

插件会先打开系统页面。不要输出 goto。

今天是 {today}。昨天是 {yesterday}。用户说今天、昨天时直接使用这两个日期。

页面控件：
- #filter-date-from、#filter-date-to：记录日期，YYYY-MM-DD，留空表示不限制
- #filter-plate：车牌，可留空
- #filter-status：全部、在途、空闲、维修中
- #btn-search 查询，#btn-reset 重置，#btn-add 新增
- #btn-delete-filtered 删除当前筛选结果，之后要点 #btn-confirm-ok
- #btn-restore 恢复初始数据，之后要点 #btn-confirm-ok
- 编辑：button[data-action="edit"][data-plate="车牌"]
- 删除一辆：button[data-action="delete"][data-plate="车牌"]，之后要点 #btn-confirm-ok
- 弹窗：#form-plate #form-type #form-driver #form-status #form-date #btn-save #btn-cancel
- 车辆类型：货车、客车、轿车。状态：在途、空闲、维修中
- 车牌形如京A10293，字母大写

规则：
1. 删除某一天的数据时，起止日期都填那一天，车牌清空，状态选全部，先查询，再删除筛选结果并确定。
2. 修改某辆车时，先按车牌查询，再点该车的编辑，改完保存。
3. 新增时点新增，填车牌、类型、司机、状态、日期后保存。没说日期就用今天，没说类型就用货车，没说状态就用空闲。
4. 与这个车辆系统无关的要求，actions 用空数组，reply 说明只能操作车辆档案。
5. 最多 8 步。reply 用一句中文说明将做什么。

删除昨天的示例：
{json.dumps(delete_yesterday, ensure_ascii=False)}

修改状态的示例：
{json.dumps(edit_one, ensure_ascii=False)}
"""


def build_llm() -> ChatOpenAI:
    api_key = os.environ.get("VOLCENGINE_API_KEY", "").strip()
    if not api_key:
        raise PlanError("未设置环境变量 VOLCENGINE_API_KEY")
    model = os.environ.get("VOLCENGINE_MODEL", DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
    base_url = os.environ.get("VOLCENGINE_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        temperature=0,
        max_tokens=1200,
        timeout=90,
        # 方舟的 Chat Completions 兼容 OpenAI。Responses API 这条模型用不上。
        use_responses_api=False,
        # 关闭深度思考，否则 JSON 会混进推理文本，也更慢。
        extra_body={"thinking": {"type": "disabled"}},
    )


def _invoke(llm: ChatOpenAI, today: str, yesterday: str, prompt: str, correction: str) -> str:
    human = f"用户口令：{prompt}"
    if correction:
        human += f"\n上次输出无法执行：{correction}\n请只输出修正后的 JSON。"
    message = llm.invoke(
        [
            SystemMessage(content=system_prompt(today, yesterday)),
            HumanMessage(content=human),
        ]
    )
    return message_text(message)


def create_plan(prompt: str, today: str, yesterday: str, system_url: str) -> Plan:
    """调用豆包，把口令变成插件能执行的操作列表。"""
    text = prompt.strip()
    if not text:
        raise PlanError("口令是空的")
    today, yesterday = resolve_dates(today, yesterday)
    if not system_url.startswith(("http://127.0.0.1", "http://localhost")):
        raise PlanError("车辆系统地址只允许本机")
    llm = build_llm()
    correction = ""
    last_raw = ""
    # 第一次若校验失败，把错误发回模型再要一次 JSON。
    for _ in range(2):
        last_raw = _invoke(llm, today, yesterday, text, correction)
        try:
            return prepare(parse_plan(last_raw), system_url)
        except PlanError as exc:
            correction = str(exc)
    raise PlanError(correction or "没有生成可执行的操作")
