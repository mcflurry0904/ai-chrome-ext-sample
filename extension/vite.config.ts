import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.ts";

// playwright-crx 的包里还留着 Node 版 Playwright、BiDi 和 Electron 的 require。
// 扩展用不到它们，但 Vite 会尝试解析并导致构建失败，所以在打包前换成空实现。
function stubNodeOnlyPlaywright(): Plugin {
  return {
    name: "stub-node-only-playwright",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("playwright-crx")) return null;
      const next = code
        .replaceAll(
          'require("../playwright")',
          '({ createPlaywright() { throw new Error("扩展里不会启动独立浏览器"); } })',
        )
        .replaceAll(
          'require("./bidiOverCdp")',
          '({ connectBidiOverCdp() { return Promise.reject(new Error("扩展里不会使用 BiDi")); } })',
        )
        .replaceAll('require("electron/index.js")', "({})");
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stubNodeOnlyPlaywright(), react(), tailwindcss(), crx({ manifest })],
  build: {
    // playwright-crx 被压缩后无法在扩展里运行。
    minify: false,
    sourcemap: true,
  },
});
