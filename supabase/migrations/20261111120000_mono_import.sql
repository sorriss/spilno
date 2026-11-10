-- Монобанк, часть 2: импорт выписки. Edge Function mono-sync раз в минуту берёт задания (mono_claim_requests),
-- делает по одному запросу к mono на токен (лимит mono: 1 запрос в минуту) и пишет результат (mono_import).
-- Счёт сначала догоняет историю окнами по 31 дню, потом раз в несколько минут перечитывает последние 3 дня:
-- так приходят новые операции, а холды становятся окончательными. Вебхук для этого не нужен.

alter table mono_connections
  add column import_months smallint not null default 1, -- глубина истории, выбранная пользователем
  add column import_from timestamptz not null default now() - interval '1 month',
  add column last_request_at timestamptz;
grant select (import_months, import_from) on mono_connections to authenticated;

alter table accounts
  add column mono_cursor timestamptz,   -- начало следующего окна выписки; null — с import_from
  add column mono_page_to timestamptz,  -- окно не влезло в 500 операций: дочитываем до этого времени
  add column mono_polled_at timestamptz;

-- Удалённую пользователем операцию из mono больше не импортируем: иначе следующий опрос вернул бы её.
-- Без внешнего ключа на families: при удалении семьи каскад удаляет операции, и триггер сослался бы на удалённую семью.
create table private.mono_deleted (
  family_id uuid not null,
  external_id text not null,
  primary key (family_id, external_id)
);
revoke all on private.mono_deleted from public, anon, authenticated;

create function private.remember_mono_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.mono_deleted values (old.family_id, old.external_id) on conflict do nothing;
  return null;
end $$;
create trigger mono_deleted after delete on transactions
  for each row when (old.source = 'mono') execute function private.remember_mono_delete();

-- Глубина истории: при увеличении счета перечитывают выписку с нового начала, повторы отсекает upsert.
create function set_mono_history(fam uuid, months int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.member_id(fam);
  start timestamptz := now() - make_interval(months => months);
begin
  if months not in (1, 3, 12) then raise exception 'unsupported history depth'; end if;
  update public.mono_connections set import_months = months, import_from = start where member_id = me;
  if not found then raise exception 'mono is not connected' using errcode = 'no_data_found'; end if;
  update public.accounts set mono_cursor = start, mono_page_to = null
    where owner_member_id = me and kind = 'mono' and (mono_cursor is null or mono_cursor > start);
end $$;

-- По одному заданию на подключение, если с прошлого запроса прошла минута. Сразу помечает их взятыми.
-- ponytail: mono-sync вызывается без JWT; ответ ничего не раскрывает, а частоту держит last_request_at.
create function mono_claim_requests()
returns table (account_id uuid, external_id text, token text, window_from timestamptz, window_to timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select distinct on (c.member_id) c.member_id, a.id, a.external_id as ext, c.secret_id,
      coalesce(a.mono_cursor, c.import_from) as w_from, a.mono_page_to
    from public.mono_connections c
      join public.accounts a on a.owner_member_id = c.member_id and a.kind = 'mono'
        and a.external_id is not null and a.archived_at is null
    where c.last_request_at is null or c.last_request_at < now() - interval '58 seconds'
    order by c.member_id, a.mono_polled_at nulls first
  ), touch_c as (
    update public.mono_connections c set last_request_at = now() from due where c.member_id = due.member_id
  ), touch_a as (
    update public.accounts a set mono_polled_at = now() from due where a.id = due.id
  )
  select due.id, due.ext, s.decrypted_secret, due.w_from,
    coalesce(due.mono_page_to, least(due.w_from + interval '31 days', now()))
  from due join vault.decrypted_secrets s on s.id = due.secret_id;
end $$;

-- Пишет страницу выписки. next_page_to не null: mono отдал 500 операций, окно дочитываем раньше этого времени.
-- Повтор не трогает правки пользователя: обновляются только холд и, у ещё личной операции, сумма.
create function mono_import(account uuid, items jsonb, window_to timestamptz, next_page_to timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  acc public.accounts;
begin
  select * into acc from public.accounts where id = account;
  if not found then return; end if;

  insert into public.transactions (
    family_id, type, amount, amount_base, occurred_at, comment, created_by_member_id, paid_by_member_id,
    account_id, category_id, is_hold, source, external_id
  )
  select acc.family_id, case when i.amount < 0 then 'expense' else 'income' end::public.transaction_type,
    i.amount, i.amount, i.occurred_at, nullif(trim(i.comment), ''), acc.owner_member_id, acc.owner_member_id,
    acc.id, cat.id, i.hold, 'mono', i.external_id
  from jsonb_to_recordset(items) as i (external_id text, occurred_at timestamptz, amount bigint, hold boolean, comment text, category text)
    left join public.categories cat on cat.family_id = acc.family_id and cat.name = i.category
      and cat.kind = 'expense' and cat.archived_at is null
  where i.amount <> 0
    and not exists (select 1 from private.mono_deleted d where d.family_id = acc.family_id and d.external_id = i.external_id)
  on conflict (family_id, source, external_id) do update set
    is_hold = excluded.is_hold,
    -- У общей операции сумму не меняем: доли перестали бы сходиться. Холд в баланс всё равно не входит.
    amount = case when public.transactions.is_shared then public.transactions.amount else excluded.amount end,
    amount_base = case when public.transactions.is_shared then public.transactions.amount_base else excluded.amount_base end;

  update public.accounts set
    mono_page_to = next_page_to,
    mono_cursor = case
      when next_page_to is not null then mono_cursor
      when window_to >= now() - interval '1 minute' then now() - interval '3 days' -- догнали: дальше перечитываем хвост
      else window_to
    end
  where id = account;
end $$;

revoke all on function set_mono_history(uuid, int) from public, anon;
grant execute on function set_mono_history(uuid, int) to authenticated;
revoke all on function mono_claim_requests() from public, anon, authenticated;
revoke all on function mono_import(uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function mono_claim_requests() to service_role;
grant execute on function mono_import(uuid, jsonb, timestamptz, timestamptz) to service_role;
