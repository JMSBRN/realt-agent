import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { Listing, SearchParams, ServerMessage, TaskResult } from "@realt-agent/shared";
import { ExtensionBridge } from "./bridge.ts";
import { Store, type Task } from "./db.ts";
import { selectListings } from "./delivery.ts";

const params: SearchParams = {
  deal: "sale",
  city: "Минск",
  rooms: [1],
  priceMinUsd: null,
  priceMaxUsd: 40000,
  areaMin: null,
  notFirstFloor: false,
  notLastFloor: false,
  keywords: [],
};

const listing = (code: number, over: Partial<Listing> = {}): Listing => ({
  id: `realt:${code}`,
  site: "realt",
  url: `https://realt.by/sale-flats/object/${code}/`,
  title: "Квартира",
  priceUsd: 38000,
  priceByn: 114000,
  rooms: 1,
  areaTotal: 34,
  storey: 3,
  storeys: 9,
  address: "Минск",
  metro: null,
  images: [],
  description: "",
  createdAt: `2026-10-${String(code % 28 + 1).padStart(2, "0")}T10:00:00+03:00`,
  ...over,
});

test("selectListings: фильтр, сортировка и «только новые» для подписки", () => {
  const store = new Store(":memory:");
  const searchId = store.addSearch(1, "однушка до 40к", params);
  const payload = { site: "realt" as const, params, maxPages: 1 };

  const first = store.addTask({ id: searchId, chat_id: 1 }, payload, false);
  const items = [listing(1), listing(5), listing(2, { rooms: 2 }), listing(3, { priceUsd: 50000 })];
  assert.deepEqual(selectListings(store, first, items).map((l) => l.id), ["realt:5", "realt:1"]);

  const watch = store.addTask({ id: searchId, chat_id: 1 }, payload, true);
  assert.deepEqual(selectListings(store, watch, [...items, listing(7)]).map((l) => l.id), ["realt:7"]);
});

test("bridge: задача уходит в расширение, результат возвращается", async () => {
  const store = new Store(":memory:");
  const results: Array<{ task: Task; result: TaskResult }> = [];
  const bridge = new ExtensionBridge(store, async (task, result) => {
    results.push({ task, result });
  });
  const port = 18765 + Math.floor(Math.random() * 1000);
  bridge.listen("127.0.0.1", port, "secret");

  // неверный токен — соединение закрывается с кодом 4401
  const bad = new WebSocket(`ws://127.0.0.1:${port}?token=wrong`);
  const code = await new Promise<number>((r) => bad.on("close", r));
  assert.equal(code, 4401);

  const searchId = store.addSearch(1, "q", params);
  store.addTask({ id: searchId, chat_id: 1 }, { site: "realt", params, maxPages: 1 }, false);

  // задача, созданная до подключения, приходит сразу после него
  const ext = new WebSocket(`ws://127.0.0.1:${port}?token=secret`);
  const msg = await new Promise<ServerMessage>((r) => ext.once("message", (d) => r(JSON.parse(d.toString()))));
  assert.equal(msg.type, "task");
  assert.equal(store.task(msg.id)?.status, "running");

  ext.send(JSON.stringify({ type: "result", id: msg.id, result: { status: "done", items: [listing(1)] } }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.status, "done");
  assert.equal(store.task(msg.id)?.status, "done");

  // повтор того же результата игнорируется
  ext.send(JSON.stringify({ type: "result", id: msg.id, result: { status: "done", items: [] } }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(results.length, 1);

  ext.close();
  bridge.close();
});
