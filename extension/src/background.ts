// 后台服务：接收侧边栏口令，问调度代理要操作步骤，再交给 playwright-crx 执行。

import { assertLocalHttp, isoDate } from "./actions";
import type { Plan, RunEvent, RunRequest } from "./protocol";
import { runActions } from "./runner";

// chrome.debugger 一次只能稳定地控一个标签页，所以同时只跑一条口令。
let busy = false;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // 旧版本 Chrome 没有这个方法时，下面的点击监听会打开侧边栏。
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});

function send(port: chrome.runtime.Port, event: RunEvent) {
  try {
    port.postMessage(event);
  } catch {
    // 侧边栏已经关掉。
  }
}

/** 等标签页加载完再附着调试器，否则 attach 会失败。 */
function waitUntilComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("车辆系统页面打开超时")), 15000);
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch((error: Error) => finish(error));
  });
}

/** 已经开着车辆系统就切过去，否则新开一页。不改用户正在看的其他网站。 */
async function openSystemTab(systemUrl: string): Promise<number> {
  const origin = new URL(systemUrl).origin;
  const tabs = await chrome.tabs.query({});
  const found = tabs.find((tab) => tab.id != null && tab.url?.startsWith(origin));
  if (found?.id != null) {
    await chrome.tabs.update(found.id, { active: true });
    if (found.windowId != null) {
      try {
        await chrome.windows.update(found.windowId, { focused: true });
      } catch {
        // 没有窗口权限时仍然可以附着到这个标签页。
      }
    }
    await waitUntilComplete(found.id);
    return found.id;
  }
  const created = await chrome.tabs.create({ url: systemUrl, active: true });
  if (created.id == null) throw new Error("没有打开车辆系统页面");
  await waitUntilComplete(created.id);
  return created.id;
}

async function requestPlan(message: RunRequest): Promise<Plan> {
  const endpoint = new URL("/api/plan", message.agentUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        prompt: message.prompt,
        page_url: message.systemUrl,
        // 日期由插件计算后交给模型，避免模型把“昨天”算错。
        today: isoDate(0),
        yesterday: isoDate(-1),
        system_url: message.systemUrl,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body.detail === "string" ? body.detail : `调度代理返回 ${response.status}`;
      throw new Error(detail);
    }
    if (!body || typeof body.reply !== "string" || !Array.isArray(body.actions)) {
      throw new Error("调度代理返回的内容无法执行");
    }
    return body as Plan;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("调度代理响应超时");
    }
    if (error instanceof TypeError) {
      throw new Error("调度代理没有响应。请先在 agent 目录启动服务。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function handleRun(port: chrome.runtime.Port, message: RunRequest) {
  let cancelled = false;
  const onDisconnect = () => {
    cancelled = true;
  };
  port.onDisconnect.addListener(onDisconnect);
  try {
    assertLocalHttp(message.systemUrl, "车辆系统地址");
    assertLocalHttp(message.agentUrl, "调度代理地址");
    const prompt = message.prompt.trim();
    if (!prompt) throw new Error("先写一句口令");

    send(port, { type: "log", text: "正在把口令发给调度代理" });
    const plan = await requestPlan({ ...message, prompt });
    if (cancelled) return;
    send(port, { type: "reply", text: plan.reply });
    if (plan.actions.length === 0) {
      send(port, { type: "done", status: "没有需要执行的页面操作" });
      return;
    }

    send(port, { type: "log", text: `已生成 ${plan.actions.length} 步操作，正在打开车辆系统` });
    const tabId = await openSystemTab(message.systemUrl);
    if (cancelled) return;
    const status = await runActions(tabId, plan.actions, (text) => send(port, { type: "log", text }), () => cancelled);
    if (cancelled) return;
    send(port, { type: "done", status: status || "操作已执行完" });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    send(port, { type: "error", text });
  } finally {
    port.onDisconnect.removeListener(onDisconnect);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "automation") return;
  port.onMessage.addListener((message: RunRequest) => {
    if (message?.type !== "RUN") return;
    if (busy) {
      send(port, { type: "error", text: "上一条口令还在执行" });
      return;
    }
    busy = true;
    void handleRun(port, message).finally(() => {
      busy = false;
    });
  });
});
