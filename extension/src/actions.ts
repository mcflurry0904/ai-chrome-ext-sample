// 把选择器翻成侧边栏里能读的中文，并限制插件只访问本机地址。

import type { Action } from "./protocol";

const SELECTOR_LABELS: Record<string, string> = {
  "#filter-date-from": "开始日期",
  "#filter-date-to": "结束日期",
  "#filter-plate": "车牌",
  "#filter-status": "状态",
  "#btn-search": "查询",
  "#btn-reset": "重置",
  "#btn-add": "新增车辆",
  "#btn-delete-filtered": "删除当前筛选结果",
  "#btn-restore": "恢复初始数据",
  "#form-plate": "车牌",
  "#form-type": "车辆类型",
  "#form-driver": "司机",
  "#form-status": "状态",
  "#form-date": "记录日期",
  "#btn-save": "保存",
  "#btn-cancel": "取消",
  "#btn-confirm-ok": "确定",
  "#btn-confirm-cancel": "取消确认",
};

export function labelOf(selector: string): string {
  const known = SELECTOR_LABELS[selector];
  if (known) return known;
  const row = selector.match(/^button\[data-action="(edit|delete)"\]\[data-plate="(.+)"\]$/);
  if (!row) return selector;
  return row[1] === "edit" ? `编辑 ${row[2]}` : `删除 ${row[2]}`;
}

export function describe(action: Action, index: number): string {
  const step = `第 ${index + 1} 步`;
  if (action.op === "goto") return `${step}：打开 ${action.value}`;
  if (action.op === "click") return `${step}：点击${labelOf(action.selector)}`;
  if (action.op === "fill") return `${step}：在${labelOf(action.selector)}填入 ${action.value || "空白"}`;
  if (action.op === "select") return `${step}：把${labelOf(action.selector)}选为 ${action.value}`;
  return `${step}：在${labelOf(action.selector)}按下 ${action.value}`;
}

export function isoDate(offset: number): string {
  const date = new Date();
  // 先拨到中午再加减天数，避免夏令时或时区把日期算偏。车辆页面用同一算法。
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 代理和车辆系统都只允许本机，避免口令把浏览器带到别的网站。 */
export function assertLocalHttp(url: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label}不是有效地址`);
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!local || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error(`${label}只允许本机的 http://127.0.0.1 或 http://localhost`);
  }
  return parsed;
}
