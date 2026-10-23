import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SearchParams, TaskPayload, TaskStatus } from "@realt-agent/shared";
import type { Draft, Step } from "./dialogue.ts";
import type { MapPoint } from "./map-page.ts";

export interface Chat {
  chat_id: number;
  result_format: "cards" | "links";
  results_limit: number;
  /** Черновик диалога и вопрос, на который ждём ответ (null — диалога нет). */
  draft: Draft;
  step: Step | null;
}

export interface Search {
  id: number;
  chat_id: number;
  query_text: string;
  params: SearchParams;
  watch: boolean;
}

export interface Task {
  id: string;
  chat_id: number;
  search_id: number;
  payload: TaskPayload;
  only_new: boolean;
  status: TaskStatus;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  result_format TEXT NOT NULL DEFAULT 'cards',
  results_limit INTEGER NOT NULL DEFAULT 5
);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  query_text TEXT NOT NULL,
  params TEXT NOT NULL,
  watch INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  only_new INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  row TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  points TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS seen (
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  PRIMARY KEY (search_id, listing_id)
);
`;

type Row = Record<string, unknown>;

const toSearch = (r: Row): Search => ({
  id: r.id as number,
  chat_id: r.chat_id as number,
  query_text: r.query_text as string,
  params: JSON.parse(r.params as string),
  watch: !!r.watch,
});

const toTask = (r: Row): Task => ({
  id: r.id as string,
  chat_id: r.chat_id as number,
  search_id: r.search_id as number,
  payload: JSON.parse(r.payload as string),
  only_new: !!r.only_new,
  status: r.status as TaskStatus,
});

/** Всё хранилище — один файл SQLite (встроенный в Node модуль node:sqlite). */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    // Колонки, добавленные после первой версии: в существующей базе их ещё нет
    const columns = (this.db.prepare("PRAGMA table_info(chats)").all() as Row[]).map((c) => c.name);
    if (!columns.includes("draft")) this.db.exec("ALTER TABLE chats ADD COLUMN draft TEXT NOT NULL DEFAULT '{}'");
    if (!columns.includes("step")) this.db.exec("ALTER TABLE chats ADD COLUMN step TEXT");
  }

  chat(chatId: number): Chat {
    this.db.prepare("INSERT OR IGNORE INTO chats (chat_id) VALUES (?)").run(chatId);
    const r = this.db.prepare("SELECT * FROM chats WHERE chat_id = ?").get(chatId) as Row;
    return {
      chat_id: r.chat_id as number,
      result_format: r.result_format as Chat["result_format"],
      results_limit: r.results_limit as number,
      draft: JSON.parse((r.draft as string) || "{}"),
      step: (r.step as Step | null) ?? null,
    };
  }

  setDialog(chatId: number, draft: Draft, step: Step | null) {
    this.db.prepare("UPDATE chats SET draft = ?, step = ? WHERE chat_id = ?").run(JSON.stringify(draft), step, chatId);
  }

  setFormat(chatId: number, format: Chat["result_format"]) {
    this.db.prepare("UPDATE chats SET result_format = ? WHERE chat_id = ?").run(format, chatId);
  }

  setLimit(chatId: number, limit: number) {
    this.db.prepare("UPDATE chats SET results_limit = ? WHERE chat_id = ?").run(limit, chatId);
  }

  addSearch(chatId: number, queryText: string, params: SearchParams): number {
    const res = this.db
      .prepare("INSERT INTO searches (chat_id, query_text, params) VALUES (?, ?, ?)")
      .run(chatId, queryText, JSON.stringify(params));
    return Number(res.lastInsertRowid);
  }

  lastSearch(chatId: number): Search | null {
    const r = this.db.prepare("SELECT * FROM searches WHERE chat_id = ? ORDER BY id DESC LIMIT 1").get(chatId);
    return r ? toSearch(r as Row) : null;
  }

  setWatch(searchId: number, watch: boolean) {
    this.db.prepare("UPDATE searches SET watch = ? WHERE id = ?").run(watch ? 1 : 0, searchId);
  }

  stopAllWatches(chatId: number): number {
    return Number(this.db.prepare("UPDATE searches SET watch = 0 WHERE chat_id = ? AND watch = 1").run(chatId).changes);
  }

  watchedSearches(): Search[] {
    return (this.db.prepare("SELECT * FROM searches WHERE watch = 1").all() as Row[]).map(toSearch);
  }

  addTask(search: Pick<Search, "id" | "chat_id">, payload: TaskPayload, onlyNew: boolean): Task {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO tasks (id, chat_id, search_id, payload, only_new) VALUES (?, ?, ?, ?, ?)")
      .run(id, search.chat_id, search.id, JSON.stringify(payload), onlyNew ? 1 : 0);
    this.db.prepare("UPDATE searches SET last_run_at = datetime('now') WHERE id = ?").run(search.id);
    return this.task(id)!;
  }

  task(id: string): Task | null {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return r ? toTask(r as Row) : null;
  }

  queuedTasks(): Task[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at").all() as Row[]).map(
      toTask,
    );
  }

  hasPendingTask(searchId: number): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM tasks WHERE search_id = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(searchId);
  }

  setTaskStatus(id: string, status: TaskStatus, error: string | null = null) {
    const finished = status !== "queued" && status !== "running";
    this.db
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, finished_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?",
      )
      .run(status, error, finished ? 1 : 0, id);
  }

  /** Задачи, отправленные в браузер, который отключился, возвращаем в очередь. */
  requeueRunning() {
    this.db.prepare("UPDATE tasks SET status = 'queued' WHERE status = 'running'").run();
  }

  /** Задачи, которые так и не выполнились, считаем проваленными. */
  expireOldTasks(minutes: number) {
    this.db
      .prepare(
        `UPDATE tasks SET status = 'failed', error = 'timeout', finished_at = datetime('now')
         WHERE status IN ('queued', 'running') AND created_at < datetime('now', ?)`,
      )
      .run(`-${minutes} minutes`);
  }

  addLead(chatId: number, row: string[]): number {
    const res = this.db.prepare("INSERT INTO leads (chat_id, row) VALUES (?, ?)").run(chatId, JSON.stringify(row));
    return Number(res.lastInsertRowid);
  }

  unsyncedLeads(): Array<{ id: number; row: string[] }> {
    return (this.db.prepare("SELECT id, row FROM leads WHERE synced = 0 ORDER BY id").all() as Row[]).map((r) => ({
      id: r.id as number,
      row: JSON.parse(r.row as string),
    }));
  }

  markLeadSynced(id: number) {
    this.db.prepare("UPDATE leads SET synced = 1 WHERE id = ?").run(id);
  }

  /** Сохраняет карту результатов; id — случайный, его не угадать по соседним. */
  addMap(title: string, points: MapPoint[]): string {
    const id = randomBytes(12).toString("hex");
    this.db.prepare("INSERT INTO maps (id, title, points) VALUES (?, ?, ?)").run(id, title, JSON.stringify(points));
    return id;
  }

  getMap(id: string): { title: string; points: MapPoint[] } | null {
    const r = this.db.prepare("SELECT title, points FROM maps WHERE id = ?").get(id) as Row | undefined;
    return r ? { title: r.title as string, points: JSON.parse(r.points as string) } : null;
  }

  deleteOldMaps(days: number) {
    this.db.prepare("DELETE FROM maps WHERE created_at < datetime('now', ?)").run(`-${days} days`);
  }

  /** Отмечает объявления показанными; возвращает id тех, что уже были показаны раньше. */
  markSeen(searchId: number, listingIds: string[]): Set<string> {
    const already = new Set<string>();
    const insert = this.db.prepare("INSERT OR IGNORE INTO seen (search_id, listing_id) VALUES (?, ?)");
    for (const id of listingIds) {
      if (insert.run(searchId, id).changes === 0) already.add(id);
    }
    return already;
  }
}
