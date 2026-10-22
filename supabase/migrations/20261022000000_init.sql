-- Профиль пользователя: связь с Telegram и настройки выдачи
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  telegram_chat_id bigint unique,
  telegram_username text,
  result_format text not null default 'cards' check (result_format in ('cards', 'links')),
  results_limit int not null default 5 check (results_limit between 1 and 20),
  -- незавершённый диалог: текст, к которому бот задал уточняющий вопрос
  pending_query text,
  created_at timestamptz not null default now()
);

-- Одноразовые коды для привязки Telegram: t.me/<bot>?start=<code>
create table public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- Сохранённые запросы пользователя
create table public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query_text text not null,
  params jsonb not null,
  watch boolean not null default false,
  created_at timestamptz not null default now(),
  last_run_at timestamptz
);
create index searches_watch_idx on public.searches (watch) where watch;

-- Задачи для расширения. Расширение слушает INSERT через Realtime.
create type public.task_status as enum ('queued', 'running', 'done', 'captcha', 'failed');
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  search_id uuid references public.searches (id) on delete cascade,
  payload jsonb not null,
  status public.task_status not null default 'queued',
  error text,
  -- monitor: прислать только новые объявления (подписка), иначе — обычный поиск
  only_new boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index tasks_user_status_idx on public.tasks (user_id, status);

-- Что уже показано пользователю по каждому запросу
create table public.seen_listings (
  search_id uuid not null references public.searches (id) on delete cascade,
  listing_id text not null,
  seen_at timestamptz not null default now(),
  primary key (search_id, listing_id)
);

-- Онлайн-статус расширения (heartbeat раз в минуту)
create table public.extension_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  version text
);

-- Профиль создаётся автоматически при регистрации
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: пользователь (и его расширение) видит только своё.
-- Сервер (webhook Telegram, API) работает с service role и RLS обходит.
alter table public.profiles enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.searches enable row level security;
alter table public.tasks enable row level security;
alter table public.seen_listings enable row level security;
alter table public.extension_sessions enable row level security;

create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);

create policy "own searches" on public.searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own tasks read" on public.tasks
  for select using (auth.uid() = user_id);
-- расширение помечает задачу как running; итог отправляет через API
create policy "own tasks update" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own extension session" on public.extension_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime для задач
alter publication supabase_realtime add table public.tasks;

-- Пользователь может менять только настройки выдачи, но не привязку Telegram
revoke update on public.profiles from authenticated;
grant update (result_format, results_limit) on public.profiles to authenticated;
