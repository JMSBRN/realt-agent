# Realt Agent

Пишете боту в Telegram «однушка в Минске до $40 000, не первый этаж». Расширение в **вашем** Chrome открывает realt.by, листает выдачу как человек, и через полминуты бот присылает подходящие квартиры: фото, цену, адрес и ссылку.

```
Telegram ──webhook──▶ Next.js (Vercel) ──Claude API: текст → параметры
                          │
                          ▼ INSERT tasks
                     Supabase Postgres ──Realtime──▶ Chrome-расширение пользователя
                          ▲                               │ открывает realt.by,
                          └──── POST /api/tasks/:id/result┘ читает __NEXT_DATA__
                          │
                          ▼
                 фильтр, «уже видел», отправка в Telegram
```

## Структура

| Путь | Что внутри |
|---|---|
| `apps/web` | Next.js 15 + Tailwind 4: сайт, кабинет, webhook Telegram, приём результатов, cron подписок |
| `apps/extension` | Chrome-расширение (WXT, MV3): вход, подписка на задачи через Realtime, поиск на realt.by |
| `packages/shared` | Общие типы и zod-схемы, адаптер realt.by (URL, разбор данных, фильтр) + тесты |
| `supabase/migrations` | Таблицы, RLS-политики, триггер профиля, Realtime |

## Как это работает

1. Пользователь входит на сайте по коду из email и нажимает «Подключить Telegram». Одноразовая ссылка `t.me/<бот>?start=<код>` связывает чат с аккаунтом.
2. В расширении он входит тем же email. Расширение подписывается на свои задачи (Supabase Realtime) и раз в минуту отмечается в `extension_sessions`.
3. Сообщение боту попадает в `/api/telegram`. Claude превращает текст в параметры (`SearchParamsSchema`) или задаёт один уточняющий вопрос.
4. Сервер создаёт `searches` и `tasks`, расширение получает задачу мгновенно.
5. Расширение открывает realt.by в фоновой вкладке с паузами и прокруткой, берёт объявления из `__NEXT_DATA__` (на 1–3 страницах) и фильтрует их.
6. Результат уходит на `/api/tasks/:id/result`. Сервер ещё раз фильтрует, отмечает показанное в `seen_listings` и отправляет в Telegram карточки с фото или список ссылок, по настройке в кабинете.
7. `/watch` в боте (или кнопка в кабинете) включает подписку. Vercel Cron раз в 30 минут ставит задачу, и приходят только новые объявления.

## Запуск

### 1. Supabase
1. Создайте проект и примените миграцию: `supabase link` → `supabase db push` (или вставьте SQL из `supabase/migrations` в SQL Editor).
2. **Authentication → Email Templates → Magic Link**: добавьте в письмо код `{{ .Token }}`. Вход и на сайте, и в расширении идёт по 6-значному коду.

### 2. Telegram
Создайте бота у @BotFather.

### 3. Веб-приложение
```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # заполнить
pnpm --filter @realt-agent/web dev
```
Webhook (нужен публичный HTTPS-адрес: деплой на Vercel или туннель вроде ngrok):
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url=https://<ваш-домен>/api/telegram \
  -d secret_token=$TELEGRAM_WEBHOOK_SECRET
```
На Vercel укажите `CRON_SECRET`: Vercel сам передаёт его в cron-запросы.

### 4. Расширение
```bash
cp apps/extension/.env.example apps/extension/.env   # заполнить
pnpm --filter @realt-agent/extension build
```
`chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → `apps/extension/.output/chrome-mv3`.
Для разработки: `pnpm --filter @realt-agent/extension dev`.

### Проверки
```bash
pnpm typecheck && pnpm test && pnpm build
```

## Ограничения и что дальше

- **Только Минск.** Другие города добавляются в `REALT_TOWNS` (`packages/shared/src/realt.ts`): townUuid берётся из параметра `addressV2` в адресе страницы realt.by.
- **Фильтры комнат и цены применяются у нас**, после загрузки 1–3 страниц выдачи. Параметры фильтров самого realt.by пока не подобраны. Их стоит найти и передавать в URL: так выдача будет точнее, а расширению придётся листать меньше страниц.
- Задача, которую браузер не выполнил за 30 минут, помечается как проваленная.
- Следующие шаги: другие сайты (Kufar, Onliner) как новые адаптеры в `packages/shared`; тарифы; публикация расширения в Chrome Web Store.
