import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Минимальный клиент Google Sheets API через сервисный аккаунт:
 * подписываем JWT встроенным crypto, меняем его на access token и дописываем строки.
 * Без googleapis — чтобы не тянуть в проект сотни мегабайт зависимостей.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** Принимает и id таблицы, и ссылку на неё целиком. */
export function parseSpreadsheetId(value: string): string {
  return value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? value.trim();
}

export class GoogleSheets {
  private token: { value: string; expires: number } | null = null;
  private headerChecked = false;
  private readonly range: string;

  constructor(
    private account: ServiceAccount,
    private spreadsheetId: string,
    tab: string | null,
    private apiBase = "https://sheets.googleapis.com",
  ) {
    // Без названия листа — первый лист таблицы
    this.range = tab ? `'${tab.replace(/'/g, "''")}'!A1` : "A1";
  }

  static fromKeyFile(path: string, spreadsheet: string, tab: string | null): GoogleSheets {
    const account = JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
    return new GoogleSheets(account, parseSpreadsheetId(spreadsheet), tab);
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expires) return this.token.value;
    const tokenUri = this.account.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(this.account.private_key);
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${b64url(signature)}`,
      }),
    });
    if (!res.ok) throw new Error(`Google token: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.apiBase}/v4/spreadsheets/${this.spreadsheetId}/values/${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Google Sheets ${method}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** Дописывает строки в конец таблицы. RAW — чтобы «+375…» не превращался в число. */
  async append(rows: string[][]) {
    await this.request("POST", `${encodeURIComponent(this.range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      values: rows,
    });
  }

  /** Если таблица пустая — пишет строку заголовков. */
  async ensureHeader(header: string[]) {
    if (this.headerChecked) return;
    const cell = this.range.replace(/A1$/, "A1:A1");
    const data = await this.request("GET", encodeURIComponent(cell));
    if (!data.values?.length) await this.append([header]);
    this.headerChecked = true;
  }
}
