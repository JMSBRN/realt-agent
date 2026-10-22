import { browser } from "wxt/browser";
import { loadSettings, saveSettings } from "@/lib/settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const serverUrl = $<HTMLInputElement>("serverUrl");
const token = $<HTMLInputElement>("token");

async function renderStatus() {
  const s = (await browser.runtime.sendMessage({ type: "status" })) as { connected: boolean; error: string };
  $("state").textContent = s.connected ? "🟢 Подключено к серверу" : `🔴 ${s.error || "Не подключено"}`;
}

$<HTMLFormElement>("settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings({ serverUrl: serverUrl.value.trim(), token: token.value.trim() });
  $("state").textContent = "Подключаюсь…";
  await browser.runtime.sendMessage({ type: "settings-changed" });
  // даём соединению установиться
  setTimeout(renderStatus, 1000);
});

const settings = await loadSettings();
serverUrl.value = settings.serverUrl;
token.value = settings.token;
renderStatus();
