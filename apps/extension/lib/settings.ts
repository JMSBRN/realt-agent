import { browser } from "wxt/browser";

/** Адрес сервера и токен задаются в popup и хранятся в chrome.storage.local. */
export interface Settings {
  serverUrl: string;
  token: string;
}

export const DEFAULT_SERVER_URL = "ws://127.0.0.1:8765";

export async function loadSettings(): Promise<Settings> {
  const s = await browser.storage.local.get(["serverUrl", "token"]);
  return { serverUrl: (s.serverUrl as string) || DEFAULT_SERVER_URL, token: (s.token as string) || "" };
}

export function saveSettings(settings: Settings) {
  return browser.storage.local.set({ ...settings });
}
