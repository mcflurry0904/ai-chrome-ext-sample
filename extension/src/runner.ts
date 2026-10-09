// 用 playwright-crx 附着到已打开的标签页，按 Agent 返回的步骤操作车辆系统。

import { crx, type CrxPage } from "playwright-crx";
import { describe } from "./actions";
import type { Action } from "./protocol";

const TIMEOUT = 8000;

async function perform(page: CrxPage, action: Action): Promise<void> {
  if (action.op === "goto") {
    const current = page.url().replace(/\/$/, "");
    const target = action.value.replace(/\/$/, "");
    if (current.startsWith(target)) return;
    await page.goto(action.value, { waitUntil: "domcontentloaded" });
    return;
  }

  const locator = page.locator(action.selector);
  if (action.op === "click") {
    await locator.click({ timeout: TIMEOUT });
    return;
  }
  if (action.op === "fill") {
    const inputType = await locator.getAttribute("type");
    // date 输入框用 fill 经常写不进去，直接改 value 并触发事件更稳。
    if (inputType === "date") {
      await locator.evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, action.value);
      return;
    }
    await locator.fill(action.value, { timeout: TIMEOUT });
    return;
  }
  if (action.op === "select") {
    await locator.selectOption(action.value, { timeout: TIMEOUT });
    return;
  }
  await locator.press(action.value, { timeout: TIMEOUT });
}

export async function runActions(
  tabId: number,
  actions: Action[],
  onStep: (text: string) => void,
  shouldStop: () => boolean,
): Promise<string> {
  // slowMo 让每一步停一下，方便看着页面确认点对了。
  const app = await crx.start({ slowMo: 280 });
  let page: CrxPage | undefined;
  try {
    // attach 使用 chrome.debugger，所以页面上会出现“正在调试此浏览器”。
    page = await app.attach(tabId);
    // 车辆系统自己有确认弹层。这里只兜底接受万一出现的原生对话框，否则 Playwright 会把它关掉并让确认失败。
    page.on("dialog", (dialog) => {
      onStep(`确认框：${dialog.message()}`);
      void dialog.accept();
    });
    for (let index = 0; index < actions.length; index += 1) {
      if (shouldStop()) throw new Error("侧边栏已关闭，操作已停止");
      const action = actions[index];
      const description = describe(action, index);
      onStep(description);
      try {
        await perform(page, action);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${description} 没有完成。${detail}`);
      }
    }
    // 页面把结果写在状态栏，执行完读回来给侧边栏。
    return (await page.locator("#status-bar").innerText()).trim();
  } finally {
    if (page) {
      try {
        await app.detach(page);
      } catch {
        // 页面可能已经脱离调试。
      }
    }
    try {
      await app.close();
    } catch {
      // 调试器可能已经释放。
    }
  }
}
