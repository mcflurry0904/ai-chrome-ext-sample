// 侧边栏只负责收口令和展示进度。真正的请求和页面操作在后台服务里。

import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "../protocol";

const EXAMPLES = [
  "我想删掉昨天的车辆数据",
  "新增一辆车牌为京C55667的货车，司机赵铁柱，状态空闲",
  "把苏E33058的状态改成维修中",
];

const DEFAULT_AGENT = "http://127.0.0.1:8765";
const DEFAULT_SYSTEM = "http://127.0.0.1:4173/";

export function App() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT);
  const [systemUrl, setSystemUrl] = useState(DEFAULT_SYSTEM);
  const [logs, setLogs] = useState<string[]>([]);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    chrome.storage.local.get(["agentUrl", "systemUrl", "prompt"]).then((saved) => {
      if (typeof saved.agentUrl === "string" && saved.agentUrl) setAgentUrl(saved.agentUrl);
      if (typeof saved.systemUrl === "string" && saved.systemUrl) setSystemUrl(saved.systemUrl);
      if (typeof saved.prompt === "string" && saved.prompt) setPrompt(saved.prompt);
      setReady(true);
    }).catch(() => setReady(true));
    return () => portRef.current?.disconnect();
  }, []);

  useEffect(() => {
    // 等读完存储再写，避免用默认口令覆盖用户上次留下的内容。
    if (!ready) return;
    chrome.storage.local.set({ agentUrl, systemUrl, prompt }).catch(() => undefined);
  }, [ready, agentUrl, systemUrl, prompt]);

  function run() {
    setRunning(true);
    setLogs([]);
    setReply("");
    setStatus("");
    setError("");
    // 断开上一条连接会让后台停掉还在跑的操作。
    portRef.current?.disconnect();
    const port = chrome.runtime.connect({ name: "automation" });
    portRef.current = port;
    port.onMessage.addListener((event: RunEvent) => {
      if (event.type === "log") setLogs((current) => [...current, event.text]);
      if (event.type === "reply") setReply(event.text);
      if (event.type === "done") {
        setStatus(event.status);
        setRunning(false);
      }
      if (event.type === "error") {
        setError(event.text);
        setRunning(false);
      }
    });
    port.onDisconnect.addListener(() => {
      setRunning(false);
    });
    port.postMessage({ type: "RUN", prompt, agentUrl, systemUrl });
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="bg-yard px-4 py-4 text-sheet">
        <h1 className="m-0 text-xl font-semibold">调度口令</h1>
        <p className="mb-0 mt-1 text-sm text-[#d5e4d8]">用一句话操作某某车辆实时管理系统</p>
      </header>

      <section className="px-4 py-4">
        <label className="block text-sm" htmlFor="prompt">要做的事</label>
        <textarea
          id="prompt"
          className="mt-2 w-full resize-y border border-rule bg-sheet px-3 py-2 text-base leading-6"
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="mt-3 flex flex-col items-start gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="bg-transparent p-0 text-left text-sm text-moss underline decoration-rule underline-offset-4"
              onClick={() => setPrompt(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 border-2 border-stamp bg-transparent px-4 py-2 font-semibold text-stamp enabled:hover:bg-stamp enabled:hover:text-sheet disabled:opacity-40"
          disabled={running || prompt.trim().length === 0}
          onClick={run}
        >
          <span className={running ? "blink" : undefined}>{running ? "正在执行" : "执行口令"}</span>
        </button>
        <p className="mb-0 mt-3 text-sm leading-6 text-moss">
          执行时 Chrome 会提示正在调试此浏览器。保留这条约提示，自动化才能继续。删完后可在车辆系统里点「恢复初始数据」。
        </p>
      </section>

      {reply ? (
        <section className="mx-4 border border-rule bg-sheet px-3 py-3">
          <h2 className="m-0 text-sm font-semibold">调度代理的理解</h2>
          <p className="mb-0 mt-1 text-sm leading-6">{reply}</p>
        </section>
      ) : null}

      {status ? (
        <p className="mx-4 mt-3 border-l-4 border-yard bg-sheet px-3 py-2 text-sm">{status}</p>
      ) : null}

      {error ? (
        <p className="mx-4 mt-3 border-l-4 border-stamp bg-sheet px-3 py-2 text-sm">{error}</p>
      ) : null}

      <section className="px-4 py-4" aria-live="polite">
        <h2 className="m-0 text-sm font-semibold">执行记录</h2>
        {logs.length === 0 ? (
          <p className="text-sm leading-6 text-moss">还没有执行记录。写好口令后点执行。</p>
        ) : (
          <ol className="m-0 mt-2 list-none p-0">
            {logs.map((line, index) => (
              <li key={`${index}-${line}`} className="border-b border-rule py-2 text-sm leading-6">
                {line}
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="px-4 pb-6 text-sm">
        <summary className="cursor-pointer">连接地址</summary>
        <label className="mt-3 block" htmlFor="system-url">
          车辆系统
          <input
            id="system-url"
            className="mt-1 w-full border border-rule bg-sheet px-2 py-1"
            value={systemUrl}
            onChange={(event) => setSystemUrl(event.target.value)}
          />
        </label>
        <label className="mt-3 block" htmlFor="agent-url">
          调度代理
          <input
            id="agent-url"
            className="mt-1 w-full border border-rule bg-sheet px-2 py-1"
            value={agentUrl}
            onChange={(event) => setAgentUrl(event.target.value)}
          />
        </label>
      </details>
    </div>
  );
}
