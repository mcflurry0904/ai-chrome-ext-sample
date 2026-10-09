// 侧边栏和后台共用的消息。actions 的字段要和 Agent 返回的 JSON 一致。

export type ActionOp = "goto" | "click" | "fill" | "select" | "press";

export type Action = {
  op: ActionOp;
  selector: string;
  value: string;
};

export type Plan = {
  reply: string;
  actions: Action[];
};

// 侧边栏通过长连接把口令交给后台。用 Port 而不是 sendMessage，是为了执行过程中持续回传日志。
export type RunRequest = {
  type: "RUN";
  prompt: string;
  agentUrl: string;
  systemUrl: string;
};

export type RunEvent =
  | { type: "log"; text: string }
  | { type: "reply"; text: string }
  | { type: "done"; status: string }
  | { type: "error"; text: string };
