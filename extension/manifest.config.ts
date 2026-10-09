// debugger 权限给 playwright-crx 附着标签页。host 只放开本机，和后台的地址检查一致。
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "车辆调度助手",
  description: "用一句话操作某某车辆实时管理系统",
  version: "1.0.0",
  action: {
    default_title: "打开调度口令",
    default_icon: {
      "16": "src/assets/icon16.png",
      "48": "src/assets/icon48.png",
    },
  },
  icons: {
    "16": "src/assets/icon16.png",
    "48": "src/assets/icon48.png",
    "128": "src/assets/icon128.png",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  permissions: ["sidePanel", "tabs", "debugger", "storage"],
  host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
});
