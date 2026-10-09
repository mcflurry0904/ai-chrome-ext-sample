"use strict";

const STORAGE_KEY = "vehicle-records-v1";
const PLATE_RE = /^[\u4e00-\u9fff][A-Z][A-Z0-9]{5}$/;

const emptyFilter = () => ({ from: "", to: "", plate: "", status: "全部" });

let records = [];
let applied = emptyFilter();
let pendingConfirm = null;

function iso(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function seed() {
  return [
    { id: "v1", plate: "京A10293", type: "货车", driver: "王建国", status: "在途", dateOffset: -1 },
    { id: "v2", plate: "沪B66721", type: "客车", driver: "李秀兰", status: "空闲", dateOffset: -1 },
    { id: "v3", plate: "粤C88016", type: "轿车", driver: "赵磊", status: "维修中", dateOffset: -1 },
    { id: "v4", plate: "苏E33058", type: "货车", driver: "陈敏", status: "在途", dateOffset: 0 },
    { id: "v5", plate: "浙A19027", type: "客车", driver: "周强", status: "空闲", dateOffset: 0 },
    { id: "v6", plate: "川A55210", type: "货车", driver: "孙丽", status: "空闲", dateOffset: -3 },
    { id: "v7", plate: "鲁B77104", type: "轿车", driver: "吴凯", status: "在途", dateOffset: -7 },
  ];
}

function recordDate(row) {
  if (typeof row.dateOffset === "number") return iso(row.dateOffset);
  return row.date || "";
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seed();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return seed();
    return parsed;
  } catch {
    return seed();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function $(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 #${id}`);
  return node;
}

function setStatus(text) {
  $("status-bar").textContent = text;
}

function readDraft() {
  return {
    from: $("filter-date-from").value,
    to: $("filter-date-to").value,
    plate: $("filter-plate").value.trim().toUpperCase(),
    status: $("filter-status").value,
  };
}

function match(row, filter) {
  const date = recordDate(row);
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  if (filter.plate && !row.plate.includes(filter.plate)) return false;
  if (filter.status && filter.status !== "全部" && row.status !== filter.status) return false;
  return true;
}

function visibleRows() {
  return records.filter((row) => match(row, applied));
}

function render() {
  const rows = visibleRows();
  $("total-count").textContent = String(records.length);
  $("summary").textContent = `当前显示 ${rows.length} 条，在册 ${records.length} 条`;
  const body = $("vehicle-body");
  if (rows.length === 0) {
    body.innerHTML = '<tr><td class="empty" colspan="7">没有符合条件的车辆记录</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((row, index) => {
      const plate = escapeHtml(row.plate);
      return `<tr>
        <td>${index + 1}</td>
        <td>${plate}</td>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.driver)}</td>
        <td><span class="status status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>${escapeHtml(recordDate(row))}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn" data-action="edit" data-plate="${plate}">编辑</button>
            <button type="button" class="btn btn-danger" data-action="delete" data-plate="${plate}">删除</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function clearFilters() {
  $("filter-date-from").value = "";
  $("filter-date-to").value = "";
  $("filter-plate").value = "";
  $("filter-status").value = "全部";
  applied = emptyFilter();
}

function closeForm() {
  $("form-mask").hidden = true;
  $("form-error").textContent = "";
}

function openForm(row) {
  $("form-error").textContent = "";
  $("modal-title").textContent = row ? "编辑车辆" : "新增车辆";
  $("form-id").value = row?.id || "";
  $("form-plate").value = row?.plate || "";
  $("form-type").value = row?.type || "货车";
  $("form-driver").value = row?.driver || "";
  $("form-status").value = row?.status || "空闲";
  $("form-date").value = row ? recordDate(row) : iso(0);
  $("form-mask").hidden = false;
  $("form-plate").focus();
}

function askConfirm(message, action) {
  pendingConfirm = action;
  $("confirm-text").textContent = message;
  $("confirm-mask").hidden = false;
  $("btn-confirm-ok").focus();
}

function closeConfirm() {
  pendingConfirm = null;
  $("confirm-mask").hidden = true;
}

function saveForm(event) {
  event.preventDefault();
  const plate = $("form-plate").value.trim().toUpperCase();
  const driver = $("form-driver").value.trim();
  const date = $("form-date").value;
  const id = $("form-id").value;
  if (!PLATE_RE.test(plate)) {
    const message = "车牌格式应为京A10293这样的 7 位";
    $("form-error").textContent = message;
    setStatus(message);
    return;
  }
  if (!driver) {
    $("form-error").textContent = "请填写司机";
    setStatus("请填写司机");
    return;
  }
  if (!date) {
    $("form-error").textContent = "请填写记录日期";
    setStatus("请填写记录日期");
    return;
  }
  const duplicated = records.some((row) => row.plate === plate && row.id !== id);
  if (duplicated) {
    $("form-error").textContent = `车牌 ${plate} 已存在`;
    setStatus(`车牌 ${plate} 已存在`);
    return;
  }
  const next = {
    id: id || `v${Date.now()}`,
    plate,
    type: $("form-type").value,
    driver,
    status: $("form-status").value,
    date,
  };
  if (id) {
    records = records.map((row) => (row.id === id ? next : row));
    setStatus(`已更新车辆 ${plate}`);
  } else {
    records = [next, ...records];
    setStatus(`已保存车辆 ${plate}`);
  }
  save();
  clearFilters();
  closeForm();
  render();
}

function deleteFiltered() {
  applied = readDraft();
  render();
  const rows = visibleRows();
  if (rows.length === 0) {
    askConfirm("没有可删除的车辆记录", () => setStatus("没有可删除的车辆记录"));
    return;
  }
  askConfirm(`确认删除当前筛选出的 ${rows.length} 条车辆记录？`, () => {
    const ids = new Set(rows.map((row) => row.id));
    const count = rows.length;
    records = records.filter((row) => !ids.has(row.id));
    save();
    render();
    setStatus(`已删除 ${count} 条车辆记录`);
  });
}

function deleteOne(plate) {
  const row = records.find((item) => item.plate === plate);
  if (!row) {
    setStatus(`没有找到车辆 ${plate}`);
    return;
  }
  askConfirm(`确认删除车辆 ${plate}？`, () => {
    records = records.filter((item) => item.plate !== plate);
    save();
    render();
    setStatus(`已删除车辆 ${plate}`);
  });
}

function restoreSeed() {
  askConfirm("确认恢复初始演示数据？当前列表会被覆盖。", () => {
    records = seed();
    save();
    clearFilters();
    render();
    setStatus("已恢复初始演示数据");
  });
}

function tick() {
  $("clock").textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

function init() {
  records = load();
  $("yesterday-label").textContent = iso(-1);
  $("btn-search").addEventListener("click", () => {
    applied = readDraft();
    render();
    setStatus(`查询到 ${visibleRows().length} 条车辆记录`);
  });
  $("btn-reset").addEventListener("click", () => {
    clearFilters();
    render();
    setStatus("已重置查询条件");
  });
  $("btn-add").addEventListener("click", () => openForm(null));
  $("btn-delete-filtered").addEventListener("click", deleteFiltered);
  $("btn-restore").addEventListener("click", restoreSeed);
  $("btn-cancel").addEventListener("click", () => {
    closeForm();
    setStatus("已取消编辑");
  });
  $("vehicle-form").addEventListener("submit", saveForm);
  $("vehicle-table").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const plate = button.dataset.plate || "";
    if (button.dataset.action === "edit") {
      const row = records.find((item) => item.plate === plate);
      if (row) openForm(row);
      return;
    }
    if (button.dataset.action === "delete") deleteOne(plate);
  });
  $("btn-confirm-ok").addEventListener("click", () => {
    const action = pendingConfirm;
    closeConfirm();
    action?.();
  });
  $("btn-confirm-cancel").addEventListener("click", () => {
    closeConfirm();
    setStatus("已取消操作");
  });
  document.querySelectorAll(".menu").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.menu === "vehicles") return;
      setStatus(`${button.textContent}尚未开通`);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("confirm-mask").hidden) {
      closeConfirm();
      setStatus("已取消操作");
      return;
    }
    if (!$("form-mask").hidden) closeForm();
  });
  tick();
  setInterval(tick, 1000);
  render();
  setStatus("就绪");
}

init();
