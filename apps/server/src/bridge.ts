import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  ProbeResultSchema,
  TaskResultSchema,
  type ProbePayload,
  type ProbeResult,
  type ServerMessage,
  type TaskResult,
} from "@realt-agent/shared";
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
  private probes = new Map<string, (r: ProbeResult) => void>();

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
        for (const done of this.probes.values()) done({ status: "failed", error: "браузер отключился" });
        this.probes.clear();
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

  /**
   * Быстрый запрос к сайту через браузер: ждём ответ, а не кладём в очередь задач.
   * Без браузера или по тайм-ауту — status: failed.
   */
  probe(payload: ProbePayload, timeoutMs = 120_000): Promise<ProbeResult> {
    if (!this.connected) return Promise.resolve({ status: "failed", error: "браузер не в сети" });
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish({ status: "failed", error: "браузер не ответил вовремя" }), timeoutMs);
      const finish = (r: ProbeResult) => {
        clearTimeout(timer);
        this.probes.delete(id);
        resolve(r);
      };
      this.probes.set(id, finish);
      const msg: ServerMessage = { type: "probe", id, payload };
      this.socket!.send(JSON.stringify(msg));
    });
  }

  private async handleMessage(raw: string) {
    const msg = JSON.parse(raw);
    if (msg?.type === "probe_result" && typeof msg.id === "string") {
      const parsed = ProbeResultSchema.safeParse(msg.result);
      this.probes.get(msg.id)?.(
        parsed.success ? parsed.data : { status: "failed", error: `неожиданный ответ расширения: ${parsed.error.message.slice(0, 200)}` },
      );
      return;
    }
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
