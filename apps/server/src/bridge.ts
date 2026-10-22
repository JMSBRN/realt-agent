import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { TaskResultSchema, type ServerMessage, type TaskResult } from "@realt-agent/shared";
import type { Store, Task } from "./db.ts";

type ResultHandler = (task: Task, result: TaskResult) => Promise<void>;

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * WebSocket-сервер для Chrome-расширения: отдаёт задачи и принимает результаты.
 * Подключён один браузер; новое подключение вытесняет старое.
 */
export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private wss: WebSocketServer | null = null;

  constructor(
    private store: Store,
    private onResult: ResultHandler,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  listen(host: string, port: number, token: string) {
    const wss = new WebSocketServer({ host, port });
    this.wss = wss;
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!tokenMatches(url.searchParams.get("token"), token)) {
        ws.close(4401, "bad token");
        return;
      }
      this.socket?.close(4000, "replaced");
      this.socket = ws;
      console.log("[bridge] расширение подключено");

      ws.on("message", (raw) => this.handleMessage(raw.toString()).catch((e) => console.error("[bridge]", e)));
      ws.on("close", () => {
        if (this.socket !== ws) return;
        this.socket = null;
        this.store.requeueRunning();
        console.log("[bridge] расширение отключено");
      });
      this.flush();
    });
    console.log(`[bridge] ws://${host}:${port}`);
  }

  close() {
    this.socket?.close();
    this.wss?.close();
  }

  /** Отправляет расширению все задачи из очереди. */
  flush() {
    if (!this.connected) return;
    for (const task of this.store.queuedTasks()) {
      const msg: ServerMessage = { type: "task", id: task.id, payload: task.payload };
      this.socket!.send(JSON.stringify(msg));
      this.store.setTaskStatus(task.id, "running");
    }
  }

  private async handleMessage(raw: string) {
    const msg = JSON.parse(raw);
    if (msg?.type !== "result" || typeof msg.id !== "string") return; // hello / ping
    const task = this.store.task(msg.id);
    if (!task || task.status !== "running") return;
    const parsed = TaskResultSchema.safeParse(msg.result);
    if (!parsed.success) console.warn("[bridge] некорректный результат", parsed.error.message);
    const result: TaskResult = parsed.success
      ? parsed.data
      : { status: "failed", error: `расширение прислало данные в неожиданном формате: ${parsed.error.message.slice(0, 200)}` };
    this.store.setTaskStatus(task.id, result.status, result.status === "failed" ? result.error : null);
    await this.onResult(task, result);
  }
}
