import assert from "node:assert/strict";
import { test } from "node:test";
import { BELARUS, knownPlace, realtTranslit, townPageUrls } from "./geo.ts";
import { buildListUrl, buildRealtUrl, mapRealtObject, matchesParams, objectPath, type RealtRawObject } from "./realt.ts";
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
  // одно значение комнат — фильтр сайта, несколько — наш
  assert.equal(new URL(buildRealtUrl({ ...base, rooms: [1] })).searchParams.get("rooms"), "1");
  assert.equal(new URL(buildRealtUrl({ ...base, rooms: [1, 2] })).searchParams.get("rooms"), null);
});

test("buildListUrl: вся страна, область, другие разделы", () => {
  const country = new URL(buildListUrl({ deal: "sale", type: "flat", place: BELARUS }));
  assert.equal(country.pathname, "/sale/flats/");
  assert.equal(country.searchParams.get("addressV2"), null);

  const region = new URL(buildListUrl({ deal: "sale", type: "house", place: knownPlace("Гомельская обл.")! }));
  assert.equal(region.pathname, "/sale/cottages/");
  assert.deepEqual(JSON.parse(region.searchParams.get("addressV2")!), [{ stateRegionUuid: "499f02f0-7b00-11eb-8943-0cc47adabd66" }]);

  assert.equal(new URL(buildListUrl({ deal: "sale", type: "newbuild", place: BELARUS })).pathname, "/newflats/");
  assert.equal(new URL(buildListUrl({ deal: "rent_day", type: "flat", place: BELARUS })).pathname, "/rent/flat-for-day/");
  assert.throws(() => buildListUrl({ deal: "rent", type: "plot", place: BELARUS }));
  assert.equal(objectPath("/sale/cottages/"), "/sale-cottages/object/");
  assert.equal(objectPath("/newflats/"), "/zhiloy-kompleks/object/");
});

test("geo: места без обращения к сайту и страницы городов", () => {
  assert.deepEqual(knownPlace("в Гомеле"), { title: "Гомель", address: { townUuid: "4c95d414-7b00-11eb-8943-0cc47adabd66" } });
  assert.equal(knownPlace("г. Минск")!.title, "Минск");
  assert.equal(knownPlace("Минская область")!.title, "Минская область");
  assert.equal(knownPlace("вся Беларусь"), BELARUS);
  assert.equal(knownPlace(""), BELARUS);
  assert.equal(knownPlace("Мозырь"), null);

  assert.equal(realtTranslit("Буда-Кошелёво"), "buda-koshelevo");
  assert.equal(realtTranslit("Слуцк"), "sluck");
  assert.equal(realtTranslit("Ивье"), "ive");
  assert.equal(realtTranslit("Бобруйск"), "bobrujsk");

  assert.deepEqual(townPageUrls("Мозырь", "Гомельская область"), ["https://realt.by/gomel-region/sale/flats/mozyr/"]);
  assert.deepEqual(townPageUrls("Борисов", "Минская"), ["https://realt.by/sale/flats/borisov/"]);
  // область не названа: сначала та, где город есть в списке, потом остальные
  const urls = townPageUrls("Пинск");
  assert.equal(urls[0], "https://realt.by/brest-region/sale/flats/pinsk/");
  assert.equal(urls.length, 6);
});

test("mapRealtObject", () => {
  const l = mapRealtObject(raw, "rent");
  assert.equal(l.id, "realt:4230328");
  assert.equal(l.url, "https://realt.by/rent-flat-for-long/object/4230328/");
  assert.equal(l.priceUsd, 660);
  assert.equal(l.priceByn, 1960);
  assert.equal(l.lat, 53.9343);
  assert.equal(l.lon, 27.5997);
  // новостройка: ссылка на ЖК, цена «от»
  const nb = mapRealtObject(
    { code: 3339949, title: "ЖК «Гулливер»", headline: "Длинное описание", priceRatesMin: { "840": 786650 }, availableYear: 2026, availableQuarter: 4 },
    "/newflats/",
  );
  assert.equal(nb.url, "https://realt.by/zhiloy-kompleks/object/3339949/");
  assert.equal(nb.title, "ЖК «Гулливер»");
  assert.equal(nb.priceUsd, 786650);
  assert.equal(nb.ready, "4 кв. 2026");
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
