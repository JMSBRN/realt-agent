import type { Api } from "grammy";
import type { Store } from "./db.ts";
import type { Draft } from "./dialogue.ts";
import { LEAD_HEADER, leadRow, leadSummary, type TgUser } from "./leads.ts";
import type { GoogleSheets } from "./sheets.ts";

/**
 * Сохраняет лид: сначала в SQLite (он не потеряется, даже если Google недоступен),
 * затем в Google Sheets и уведомлением риелтору. Неотправленные лиды досылаются при следующей синхронизации.
 */
export class LeadService {
  private syncing = false;

  constructor(
    private store: Store,
    private api: Api,
    private sheets: GoogleSheets | null,
    private realtorChatIds: number[],
  ) {}

  async save(chatId: number, draft: Draft, tg: TgUser) {
    const row = leadRow(draft, tg);
    this.store.addLead(chatId, row);
    console.log(`[lead] новый лид от ${tg.username ? "@" + tg.username : tg.id}`);
    for (const id of this.realtorChatIds) {
      await this.api.sendMessage(id, leadSummary(row), { parse_mode: "HTML" }).catch((e) => console.error("[lead] уведомление", e));
    }
    await this.sync();
  }

  /** Досылает в Google Sheets все лиды, которые ещё не ушли. */
  async sync() {
    if (!this.sheets || this.syncing) return;
    const pending = this.store.unsyncedLeads();
    if (!pending.length) return;
    this.syncing = true;
    try {
      await this.sheets.ensureHeader(LEAD_HEADER);
      for (const lead of pending) {
        await this.sheets.append([lead.row]);
        this.store.markLeadSynced(lead.id);
      }
      console.log(`[lead] в Google Sheets отправлено: ${pending.length}`);
    } catch (e) {
      console.error("[lead] Google Sheets недоступен, повторю позже:", e instanceof Error ? e.message : e);
    } finally {
      this.syncing = false;
    }
  }
}
