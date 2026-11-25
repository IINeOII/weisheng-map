-- 維生地圖：群眾回報 / 人工整理 / 贊助店家 資料表
-- 在 Supabase 專案的 SQL Editor 貼上執行一次即可

create table if not exists public.places (
  id            uuid primary key default gen_random_uuid(),
  layer         text not null check (layer in ('free', 'cheap')),
  category      text not null,
  name          text not null check (char_length(name) between 1 and 80),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  address       text,
  opening       text,
  item          text,
  price_twd     integer check (price_twd is null or price_twd between 0 and 5000),
  conditions    text,
  description   text check (description is null or char_length(description) <= 400),
  phone         text,
  source_url    text,
  -- 營收：贊助刊登（只能由管理員在後台設定）
  sponsored     boolean not null default false,
  sponsor_name  text,
  sponsor_until date,
  -- 審核
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  last_verified date,
  created_at    timestamptz not null default now()
);

create index if not exists places_status_idx on public.places (status);

alter table public.places enable row level security;

-- 任何人都能讀「已核准」的地點
drop policy if exists "public read approved" on public.places;
create policy "public read approved" on public.places
  for select to anon, authenticated
  using (status = 'approved');

-- 任何人都能回報，但只能是待審、非贊助
drop policy if exists "public submit pending" on public.places;
create policy "public submit pending" on public.places
  for insert to anon, authenticated
  with check (status = 'pending' and sponsored = false and sponsor_until is null and last_verified is null);

-- 審核、改贊助狀態：用 Supabase 後台的 Table Editor（service role）操作，不開放前端修改

-- 防灌水：同一位置 5 分鐘內最多 20 筆待審回報（簡易版）
create or replace function public.limit_pending_flood() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.places
      where status = 'pending' and created_at > now() - interval '5 minutes') > 20 then
    raise exception '回報太頻繁，請稍後再試';
  end if;
  return new;
end $$;

drop trigger if exists places_flood on public.places;
create trigger places_flood before insert on public.places
  for each row execute function public.limit_pending_flood();
