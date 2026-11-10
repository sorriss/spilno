-- Расписание импорта монобанка. Выполнить один раз в SQL Editor, после выкладки функции mono-sync.
-- Не миграция: тестовая БД (PGlite) не знает pg_cron, а адрес функции свой у каждого проекта.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mono-sync',
  '* * * * *',
  $$ select net.http_post(url := 'https://qggtvnnbhxfbjcrmldbo.supabase.co/functions/v1/mono-sync', body := '{}'::jsonb) $$
);

-- Остановить: select cron.unschedule('mono-sync');
