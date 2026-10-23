import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Api } from "grammy";
import { Store } from "./db.ts";
import type { Draft } from "./dialogue.ts";
import { LeadService } from "./lead-service.ts";
import { LEAD_HEADER, leadRow, leadSummary } from "./leads.ts";
import { GoogleSheets, parseSpreadsheetId } from "./sheets.ts";

const draft: Draft = {
  mode: "detailed",
  deal: "sale",
  rooms: [2],
  budget: { min: 60000, max: 90000 },
  areaMin: null,
  floor: { notFirst: true, notLast: false },
  district: "Уручье",
  profile: { household: "Семья с детьми", kids: "двое", pets: "Кошка", payment: "Ипотека / кредит" },
  contact: { consent: true, name: "Анна", phone: "+375291234567", email: "anna@mail.ru", social: "Viber", time: "Вечером" },
};
const tg = { id: 42, username: "anna_m", firstName: "Аня" };

test("строка лида: контакты, параметры и анкета по колонкам", () => {
  const row = leadRow(draft, tg, new Date("2026-10-23T09:00:00Z"));
  assert.equal(row.length, LEAD_HEADER.length);
  const col = (name: string) => row[LEAD_HEADER.indexOf(name)];
  assert.equal(col("Статус"), "Новый");
  assert.equal(col("Телефон"), "+375291234567");
  assert.equal(col("Telegram"), "@anna_m");
  assert.equal(col("Бюджет до, $"), "90000");
  assert.equal(col("Этаж"), "не первый");
  assert.equal(col("Дети"), "двое");
  assert.equal(col("Оплата"), "Ипотека / кредит");
  assert.match(col("Дата")!, /23\.10\.2026/);
  assert.match(leadSummary(row), /Новый лид[\s\S]*Анна[\s\S]*\+375291234567/);
});

test("ссылка на таблицу или её id", () => {
  assert.equal(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC-xyz_09/edit#gid=0"), "1AbC-xyz_09");
  assert.equal(parseSpreadsheetId("1AbC-xyz_09"), "1AbC-xyz_09");
});

test("лид сохраняется в базе, уходит в Google Sheets (с заголовком) и досылается после сбоя", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const appended: string[][][] = [];
  let failNext = true;

  // Поддельный Google: проверяем подпись JWT и записываем, что пришло в таблицу
  const google = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/token") {
      const assertion = new URLSearchParams(body).get("assertion")!;
      const [h, c, s] = assertion.split(".");
      const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url"));
      const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
      assert.ok(ok, "подпись JWT неверна");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
      return res.end(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    assert.equal(req.headers.authorization, "Bearer tok");
    if (req.method === "GET") return res.end(JSON.stringify({})); // таблица пустая
    if (failNext) {
      failNext = false;
      res.statusCode = 503;
      return res.end("unavailable");
    }
    assert.match(req.url!, /^\/v4\/spreadsheets\/SHEET\/values\/'%D0%9B%D0%B8%D0%B4%D1%8B'!A1:append\?valueInputOption=RAW/);
    appended.push(JSON.parse(body).values);
    res.end("{}");
  });
  google.listen(0, "127.0.0.1");
  await once(google, "listening");
  const base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;

  const sheets = new GoogleSheets(
    { client_email: "bot@test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, token_uri: `${base}/token` },
    "SHEET",
    "Лиды",
    base,
  );
  const sent: Array<{ chat: number; text: string }> = [];
  const api = { sendMessage: async (chat: number, text: string) => (sent.push({ chat, text }), {}) } as unknown as Api;
  const store = new Store(":memory:");
  const leads = new LeadService(store, api, sheets, [777]);

  await leads.save(42, draft, tg);
  // Google ответил 503 на заголовок — лид остался в базе неотправленным, риелтор уведомлён
  assert.equal(store.unsyncedLeads().length, 1);
  assert.equal(sent[0]!.chat, 777);

  await leads.sync();
  assert.equal(store.unsyncedLeads().length, 0);
  assert.deepEqual(appended[0], [LEAD_HEADER]);
  assert.equal(appended[1]![0]![LEAD_HEADER.indexOf("Имя")], "Анна");
  google.close();
});
