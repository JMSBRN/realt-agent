import type { RealtimeChannel } from "@supabase/supabase-js";
import type { TaskPayload, TaskResult } from "@realt-agent/shared";
import { browser } from "wxt/browser";
import { CaptchaError, scrapeRealt } from "@/lib/scrape-realt";
import { API_URL, createSupabase } from "@/lib/supabase";

interface TaskRow {
  id: string;
  payload: TaskPayload;
  status: string;
}

export default defineBackground(() => {
  const sb = createSupabase(true);
  let userId: string | null = null;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let queue: Promise<void> = Promise.resolve(); // один браузер — одна задача за раз
  const taken = new Set<string>();

  function setBadge() {
    browser.action.setBadgeText({ text: userId ? (subscribed ? "ON" : "…") : "" });
    browser.action.setBadgeBackgroundColor({ color: subscribed ? "#059669" : "#9ca3af" });
  }

  /** Подписка на новые задачи пользователя; вызывается при старте, входе/выходе и раз в минуту. */
  async function sync() {
    const {
      data: { session },
    } = await sb.auth.getSession();
    const uid = session?.user.id ?? null;

    if (uid !== userId || !channel) {
      if (channel) await sb.removeChannel(channel);
      channel = null;
      subscribed = false;
      userId = uid;
      if (uid) {
        channel = sb
          .channel(`tasks:${uid}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "tasks", filter: `user_id=eq.${uid}` },
            (change) => enqueue(change.new as TaskRow),
          )
          .subscribe((status) => {
            subscribed = status === "SUBSCRIBED";
            setBadge();
          });
      }
    }
    setBadge();
    if (!userId) return;

    await sb
      .from("extension_sessions")
      .upsert({ user_id: userId, last_seen: new Date().toISOString(), version: browser.runtime.getManifest().version });
    // Подхватываем задачи, пришедшие, пока браузер был закрыт или worker спал
    const { data } = await sb.from("tasks").select("id, payload, status").eq("status", "queued").order("created_at");
    for (const task of data ?? []) enqueue(task as TaskRow);
  }

  function enqueue(task: TaskRow) {
    if (task.status !== "queued" || taken.has(task.id)) return;
    taken.add(task.id);
    queue = queue.then(() => runTask(task)).catch((e) => console.error("task failed", task.id, e));
  }

  async function runTask(task: TaskRow) {
    // Забираем задачу атомарно: если её уже взял другой браузер, пропускаем
    const { data: claimed } = await sb
      .from("tasks")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", task.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) return;

    let result: TaskResult;
    try {
      result = { status: "done", items: await scrapeRealt(task.payload) };
    } catch (e) {
      result = e instanceof CaptchaError ? { status: "captcha" } : { status: "failed", error: String(e) };
    }
    await postResult(task.id, result);
  }

  async function postResult(taskId: string, result: TaskResult) {
    const {
      data: { session },
    } = await sb.auth.getSession();
    const res = await fetch(`${API_URL}/api/tasks/${taskId}/result`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(result),
    });
    if (!res.ok) throw new Error(`result upload failed: ${res.status}`);
  }

  // Будильник раз в минуту: heartbeat и восстановление подписки после сна service worker
  browser.alarms.create("sync", { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(() => sync());
  browser.runtime.onStartup.addListener(() => sync());

  // Сообщения от popup
  browser.runtime.onMessage.addListener((msg: { type: string }, _sender, sendResponse) => {
    if (msg.type === "auth-changed") sync().then(() => sendResponse({ ok: true }));
    if (msg.type === "status") sendResponse({ loggedIn: !!userId, subscribed });
    return true;
  });

  sync();
});
