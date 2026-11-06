import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { basename } from "node:path";

type Block = { type?: string; text?: string };
type Message = { role?: string; content?: Block[]; stopReason?: string };

const MIN_MS = Number.parseInt(process.env.PI_NOTIFY_MIN_MS ?? "3000", 10) || 0;

function lastAssistant(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant" && Array.isArray(message.content)) return message;
  }
  return undefined;
}

function preview(message: Message | undefined): string {
  const text = (message?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  const line = text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

function send(title: string, body: string): void {
  const display = process.env.DISPLAY ?? ":0";
  const env = { ...process.env, DISPLAY: display };
  execFile("herbe", [title, body], { env, timeout: 10_000, killSignal: "SIGKILL" }, () => {});
  execFile("paplay", ["/usr/share/sounds/freedesktop/stereo/message.oga"], { env }, () => {});
}

export default function (pi: ExtensionAPI) {
  let startedAt: number | null = null;

  pi.on("agent_start", async () => {
    startedAt = Date.now();
  });

  pi.on("agent_end", async (event, ctx) => {
    const began = startedAt;
    startedAt = null;

    if (!ctx.hasUI) return;
    if (ctx.hasPendingMessages()) return;
    if (began !== null && Date.now() - began < MIN_MS) return;

    const message = lastAssistant((event.messages ?? []) as unknown as Message[]);
    if (message?.stopReason === "aborted") return;

    const failed = message?.stopReason === "error";
    const body = failed ? `❌ ${preview(message) || "Erreur"}` : preview(message) || "✅ Terminé";

    const folder = basename(ctx.cwd);
    const title = folder ? `pi - ${folder}` : "pi";
    send(title, body);
  });
}
