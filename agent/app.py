"""插件通过 HTTP 把口令交给规划器，拿回一组页面操作。"""

import logging
import sys

from fastapi import FastAPI, HTTPException

# 这台机器的控制台默认不是 UTF-8，中文日志会在打印时抛编码错误。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from planner import DEFAULT_MODEL_ID, PlanError, create_plan

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("vehicle-agent")

app = FastAPI(title="车辆调度代理")
app.add_middleware(
    CORSMiddleware,
    # 侧边栏的来源是 chrome-extension://，不能写死具体扩展 ID。
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PlanIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    page_url: str = ""
    today: str = ""
    yesterday: str = ""
    system_url: str = "http://127.0.0.1:4173/"


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "vehicle-agent", "health": "/api/health", "plan": "/api/plan"}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"ok": "true", "model": DEFAULT_MODEL_ID}


@app.post("/api/plan")
def plan(body: PlanIn) -> dict:
    """返回 {reply, actions}。校验或模型失败时用 502，detail 是给侧边栏看的中文原因。"""
    logger.info("plan prompt=%s", body.prompt)
    try:
        result = create_plan(body.prompt, body.today, body.yesterday, body.system_url)
    except PlanError as exc:
        logger.warning("plan failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("plan crashed")
        raise HTTPException(status_code=502, detail="调度代理调用模型失败") from exc
    payload = result.model_dump()
    logger.info("plan actions=%s", payload["actions"])
    return payload
