import type { ExtensionMessage, ProbePayload, ServerMessage, TaskPayload, TaskResult } from "@realt-agent/shared";
import { browser } from "wxt/browser";
import { CaptchaError, probeRealt, scrapeRealt } from "@/lib/scrape-realt";
import { loadSettings } from "@/lib/settings";

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let lastError = "";
  let queue: Promise<void> = Promise.resolve(); // один браузер — одна задача за раз
  const taken = new Set<string>();

  const isOpen = () => ws?.readyState === WebSocket.OPEN;

  function send(msg: ExtensionMessage) {
    if (isOpen()) ws!.send(JSON.stringify(msg));
  }

  function setBadge() {
    browser.action.setBadgeText({ text: isOpen() ? "ON" : "OFF" });
    browser.action.setBadgeBackgroundColor({ color: isOpen() ? "#059669" : "#9ca3af" });
  }

  /** Подключается к серверу, если ещё не подключены. Вызывается при старте, из popup и раз в минуту. */
  async function connect(force = false) {
    if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws?.close();
    const { serverUrl, token } = await loadSettings();
    if (!token) {
      lastError = "Укажите токен сервера";
      setBadge();
      return;
    }
    const socket = new WebSocket(`${serverUrl}?token=${encodeURIComponent(token)}`);
    ws = socket;
    socket.onopen = () => {
      lastError = "";
      send({ type: "hello", version: browser.runtime.getManifest().version });
      setBadge();
    };
    socket.onclose = (e) => {
      if (ws === socket) ws = null;
      lastError = e.code === 4401 ? "Неверный токен" : "Сервер недоступен";
      setBadge();
    };
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === "task") enqueue(msg.id, msg.payload);
      if (msg.type === "probe") enqueueProbe(msg.id, msg.payload);
    };
  }

  function enqueue(id: string, payload: TaskPayload) {
    if (taken.has(id)) return;
    taken.add(id);
    queue = queue.then(() => runTask(id, payload)).catch((e) => console.error("task failed", id, e));
  }

  /** Быстрые запросы («сколько однушек в Гомеле») — в ту же очередь: вкладки не мешают друг другу. */
  function enqueueProbe(id: string, payload: ProbePayload) {
    if (taken.has(id)) return;
    taken.add(id);
    queue = queue
      .then(async () => {
        const result = await probeRealt(payload);
        send({ type: "probe_result", id, result });
      })
      .catch((e) => console.error("probe failed", id, e));
  }

  async function runTask(id: string, payload: TaskPayload) {
    let result: TaskResult;
    try {
      result = { status: "done", ...(await scrapeRealt(payload)) };
    } catch (e) {
      result = e instanceof CaptchaError ? { status: "captcha" } : { status: "failed", error: String(e) };
    }
    // Если соединение пропало, сервер вернёт задачу в очередь и пришлёт её снова
    if (isOpen()) send({ type: "result", id, result });
    else taken.delete(id);
  }

  // Service worker в MV3 засыпает после ~30 с простоя; сообщения по WebSocket его будят (Chrome 116+)
  setInterval(() => send({ type: "ping" }), 20_000);
  // Будильник раз в минуту переподключает, если worker всё-таки перезапускался
  browser.alarms.create("connect", { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(() => connect());
  browser.runtime.onStartup.addListener(() => connect());

  browser.runtime.onMessage.addListener((msg: { type: string }, _sender, sendResponse) => {
    if (msg.type === "settings-changed") connect(true).then(() => sendResponse({ ok: true }));
    if (msg.type === "status") sendResponse({ connected: isOpen(), error: lastError });
    return true;
  });

  connect();
});
