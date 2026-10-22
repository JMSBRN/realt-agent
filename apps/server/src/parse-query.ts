import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ParseResultSchema, type ParseResult } from "@realt-agent/shared";
import { config } from "./config.ts";
import { simpleParse } from "./simple-parser.ts";

// Без ключа Claude бот разбирает запросы правилами (simple-parser.ts)
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const SYSTEM = `Ты разбираешь запросы на поиск квартир в Беларуси (сайт realt.by) и превращаешь их в параметры поиска.

Правила:
- deal: «купить», «продажа» → sale; «снять», «аренда» → rent.
- Цены переводи в доллары США. Сумма без валюты — это доллары. Белорусские рубли переводи по курсу {RATE} BYN за 1 USD.
- «40к», «40 тыс» = 40000. «однушка» = 1 комната, «двушка» = 2, «трёшка» = 3; «студия» = 1.
- Район, улицу, метро и пожелания вроде «с ремонтом» клади в keywords, по одному-двум словам на пункт, в той форме, в какой они пишутся в объявлениях («Уручье», «ремонт»).
- Если неясно, купить или снять, или не указан город — верни params = null и один короткий вопрос в question.
- Остальные параметры необязательны: не спрашивай про них, оставляй null или пустыми.`;

/** Превращает текст пользователя в параметры поиска или уточняющий вопрос. */
export async function parseQuery(text: string): Promise<ParseResult> {
  const rate = Number(config.usdBynRate);
  if (!client) return simpleParse(text, rate);
  try {
    return await parseWithClaude(client, text);
  } catch (e) {
    console.error("[claude] разбор не удался, использую правила:", e);
    return simpleParse(text, rate);
  }
}

async function parseWithClaude(client: Anthropic, text: string): Promise<ParseResult> {
  const response = await client.beta.messages.parse({
    model: config.claudeModel,
    max_tokens: 16000,
    // Простое извлечение: низкого усилия достаточно
    output_config: { effort: "low", format: betaZodOutputFormat(ParseResultSchema) },
    // Если модель откажет по политике, API сам повторит запрос на запасной модели
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM.replace("{RATE}", config.usdBynRate),
    messages: [{ role: "user", content: text }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { params: null, question: "Не удалось разобрать запрос. Сформулируйте, пожалуйста, иначе." };
  }
  return response.parsed_output;
}
