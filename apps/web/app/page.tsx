import Link from "next/link";

const steps = [
  ["Напишите боту", "«Однушка в Минске до $40 000, не первый этаж» — обычным текстом."],
  ["Браузер ищет сам", "Расширение открывает realt.by в вашем Chrome и листает объявления, как человек."],
  ["Получите варианты", "Фото, цена, адрес и ссылка — прямо в Telegram. Новые объявления — по подписке."],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Realt Agent</h1>
      <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
        Ищет квартиры на realt.by по вашему запросу в Telegram — через ваш собственный браузер.
      </p>
      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {steps.map(([title, text], i) => (
          <li key={title} className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="text-sm font-medium text-emerald-600">Шаг {i + 1}</div>
            <div className="mt-1 font-semibold">{title}</div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
          </li>
        ))}
      </ol>
      <Link
        href="/dashboard"
        className="mt-10 inline-block rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-700"
      >
        Начать
      </Link>
    </main>
  );
}
