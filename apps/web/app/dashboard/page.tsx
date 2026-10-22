import type { SearchParams } from "@realt-agent/shared";
import { createClient } from "@/lib/supabase/server";
import { describeParams } from "@/lib/format";
import { createTelegramLink, setWatch, signOut, updateSettings } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  queued: "в очереди",
  running: "ищет",
  done: "готово",
  captcha: "капча",
  failed: "ошибка",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

const button = "rounded-xl bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700";

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: ext }, { data: searches }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user!.id).single(),
    supabase.from("extension_sessions").select("last_seen, version").maybeSingle(),
    supabase
      .from("searches")
      .select("id, query_text, params, watch, created_at, tasks(status, created_at)")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const extOnline = !!ext && Date.now() - new Date(ext.last_seen).getTime() < 3 * 60 * 1000;

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Кабинет</h1>
        <form action={signOut}>
          <button className="text-sm text-zinc-500 hover:underline">Выйти ({user!.email})</button>
        </form>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="1. Расширение Chrome">
          <p>{extOnline ? "🟢 Подключено" : "🔴 Не в сети"}</p>
          <p className="mt-2 text-zinc-500">
            Установите расширение, войдите в нём тем же email и держите Chrome открытым.
          </p>
        </Card>

        <Card title="2. Telegram">
          {profile?.telegram_chat_id ? (
            <p>✅ Подключён{profile.telegram_username ? ` (@${profile.telegram_username})` : ""}</p>
          ) : (
            <p className="text-zinc-500">Не подключён</p>
          )}
          <form action={createTelegramLink} className="mt-3">
            <button className={button}>{profile?.telegram_chat_id ? "Переподключить" : "Подключить Telegram"}</button>
          </form>
        </Card>
      </div>

      <Card title="Как присылать результаты">
        <form action={updateSettings} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            Формат
            <select
              name="result_format"
              defaultValue={profile?.result_format}
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            >
              <option value="cards">Фото с описанием</option>
              <option value="links">Только ссылки</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Сколько вариантов
            <input
              name="results_limit"
              type="number"
              min={1}
              max={20}
              defaultValue={profile?.results_limit}
              className="w-24 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            />
          </label>
          <button className={button}>Сохранить</button>
        </form>
      </Card>

      <Card title="Последние запросы">
        {!searches?.length && <p className="text-zinc-500">Пока пусто — напишите боту в Telegram.</p>}
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {searches?.map((s) => {
            const last = [...(s.tasks ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="truncate">{describeParams(s.params as SearchParams)}</div>
                  <div className="text-xs text-zinc-500">
                    {new Date(s.created_at).toLocaleString("ru-RU")}
                    {last && ` · ${STATUS_LABEL[last.status] ?? last.status}`}
                  </div>
                </div>
                <form action={setWatch.bind(null, s.id, !s.watch)}>
                  <button className="rounded-lg border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700">
                    {s.watch ? "👁 Следит · выключить" : "Следить за новыми"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>
    </main>
  );
}
