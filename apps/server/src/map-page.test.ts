import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Listing } from "@realt-agent/shared";
import { Store } from "./db.ts";
import { renderMapPage, startMapServer, toPoints } from "./map-page.ts";

const listing = (over: Partial<Listing>): Listing => ({
  id: "realt:1",
  site: "realt",
  url: "https://realt.by/sale-flats/object/1/",
  title: "Квартира",
  priceUsd: 58200,
  priceByn: 174000,
  rooms: 1,
  areaTotal: 34,
  storey: 3,
  storeys: 9,
  address: "Минск, Притыцкого 29",
  metro: null,
  images: [],
  description: "",
  createdAt: null,
  lat: 53.9,
  lon: 27.5,
  ...over,
});

test("на карту попадают только объявления с координатами", () => {
  const points = toPoints([listing({}), listing({ id: "realt:2", lat: null })]);
  assert.equal(points.length, 1);
  assert.equal(points[0]!.price, "$58 200");
  assert.equal(points[0]!.details, "1-комн. · 34 м² · этаж 3/9");
});

test("текст объявления не может закрыть <script> на странице", () => {
  const html = renderMapPage("t", toPoints([listing({ title: "</script><script>alert(1)</script>" })]));
  assert.ok(!html.includes("</script><script>alert(1)"));
});

test("сервер отдаёт карту по id и 404 на чужой id", async () => {
  const store = new Store(":memory:");
  const id = store.addMap("1 вариант", toPoints([listing({})]));
  const server = startMapServer(store, "127.0.0.1", 0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const ok = await fetch(`${base}/map/${id}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /realt\.by\/sale-flats\/object\/1/);

  assert.equal((await fetch(`${base}/map/${"0".repeat(24)}`)).status, 404);
  assert.equal((await fetch(`${base}/`)).status, 404);
  server.close();
});
