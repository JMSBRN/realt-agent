import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRealtUrl, mapRealtObject, matchesParams, type RealtRawObject } from "./realt.ts";
import type { SearchParams } from "./schemas.ts";

// Урезанный реальный объект с realt.by (октябрь 2026)
const raw: RealtRawObject = {
  code: 4230328,
  headline: "Ремонт, новая мебель, сантехника, кухня",
  price: 1960,
  priceRates: { "840": 660, "933": 1960 },
  rooms: 2,
  areaTotal: 52.1,
  storey: 4,
  storeys: 5,
  address: "Минск Коласа ул. 59 2",
  images: ["https://cdn.realt.by/img/55/9851cfb8-ad15-11f1-8681-0242ac120002"],
  createdAt: "2026-09-10T16:05:51+03:00",
  location: [27.5997, 53.9343],
};

const base: SearchParams = {
  deal: "rent",
  city: "Минск",
  rooms: [],
  priceMinUsd: null,
  priceMaxUsd: null,
  areaMin: null,
  notFirstFloor: false,
  notLastFloor: false,
  keywords: [],
};

test("buildRealtUrl", () => {
  const url = new URL(buildRealtUrl({ ...base, deal: "sale" }, 2));
  assert.equal(url.pathname, "/sale/flats/");
  assert.equal(url.searchParams.get("page"), "2");
  assert.deepEqual(JSON.parse(url.searchParams.get("addressV2")!), [
    { townUuid: "4cb07174-7b00-11eb-8943-0cc47adabd66" },
  ]);
  assert.throws(() => buildRealtUrl({ ...base, city: "Пинск" }));
});

test("mapRealtObject", () => {
  const l = mapRealtObject(raw, "rent");
  assert.equal(l.id, "realt:4230328");
  assert.equal(l.url, "https://realt.by/rent-flat-for-long/object/4230328/");
  assert.equal(l.priceUsd, 660);
  assert.equal(l.priceByn, 1960);
  assert.equal(l.lat, 53.9343);
  assert.equal(l.lon, 27.5997);
});

test("matchesParams", () => {
  const l = mapRealtObject(raw, "rent");
  assert.ok(matchesParams(l, base));
  assert.ok(matchesParams(l, { ...base, rooms: [2], priceMaxUsd: 700, keywords: ["коласа"] }));
  assert.ok(!matchesParams(l, { ...base, rooms: [1] }));
  assert.ok(!matchesParams(l, { ...base, priceMaxUsd: 600 }));
  assert.ok(!matchesParams(l, { ...base, areaMin: 60 }));
  assert.ok(!matchesParams({ ...l, storey: 5 }, { ...base, notLastFloor: true }));
});
