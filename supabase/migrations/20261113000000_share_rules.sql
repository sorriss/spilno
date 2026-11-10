-- Правила спільних: новая операция с карты mono становится общей, если подходит под правило владельца карты.
-- Правило своё у каждого участника и действует только на его карты: чужие личные операции никто не трогает.
-- Срабатывает один раз на новую операцию, когда она уже не холд: у холда сумма может уточниться, а у общей
-- операции сумма не меняется, иначе доли перестали бы сходиться. Импортированное раньше не трогаем.

create table share_rules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  member_id uuid not null,
  category_id uuid,
  merchant text check (length(trim(merchant)) >= 2), -- фрагмент описания mono, без учёта регистра
  member_ids uuid[], -- между кем делить порівну; null — вся семья на момент операции
  created_at timestamptz not null default now(),
  check ((category_id is null) <> (merchant is null)),
  foreign key (family_id, member_id) references family_members (family_id, id),
  foreign key (family_id, category_id) references categories (family_id, id)
);
alter table share_rules enable row level security;
create policy own_read on share_rules for select to authenticated
  using (member_id = private.member_id(family_id));
create policy own_insert on share_rules for insert to authenticated
  with check (member_id = private.member_id(family_id) and private.has_role(family_id, 'owner', 'member'));
create policy own_delete on share_rules for delete to authenticated
  using (member_id = private.member_id(family_id));
revoke all on share_rules from anon, authenticated;
grant select, insert, delete on share_rules to authenticated;

-- Новая операция из mono ждёт правил, пока не станет окончательной. Остальные операции правила не касаются.
alter table transactions add column rule_pending boolean not null default false;

create function private.apply_share_rules(ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  r public.share_rules;
  people uuid[];
  n int;
begin
  for t in
    select * from public.transactions where id = any(ids) and rule_pending and not is_hold
  loop
    update public.transactions set rule_pending = false where id = t.id;
    -- Перевод, общая (её уже поделили вручную) и доход правилами не делятся.
    continue when t.type <> 'expense' or t.is_shared;

    select * into r from public.share_rules sr
    where sr.member_id = t.paid_by_member_id
      and (sr.category_id = t.category_id or strpos(lower(coalesce(t.comment, '')), lower(trim(sr.merchant))) > 0)
    order by sr.merchant is null, sr.created_at -- сначала правила по магазину: они точнее
    limit 1;
    continue when not found;

    -- Делим между действующими участниками из правила; порядок вступления решает, кому достанется лишняя копейка.
    select array_agg(m.id order by m.joined_at) into people from public.family_members m
    where m.family_id = t.family_id and m.left_at is null and (r.member_ids is null or m.id = any(r.member_ids));
    n := coalesce(array_length(people, 1), 0);
    continue when n = 0;

    update public.transactions set is_shared = true, split_mode = 'equal' where id = t.id;
    insert into public.transaction_shares (family_id, transaction_id, member_id, amount)
      select t.family_id, t.id, p.member_id, abs(t.amount_base) / n + case when p.pos <= abs(t.amount_base) % n then 1 else 0 end
      from unnest(people) with ordinality as p (member_id, pos)
      where abs(t.amount_base) / n + case when p.pos <= abs(t.amount_base) % n then 1 else 0 end > 0;
  end loop;
end $$;

create or replace function mono_import(account uuid, items jsonb, window_to timestamptz, next_page_to timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  acc public.accounts;
  touched uuid[];
begin
  select * into acc from public.accounts where id = account;
  if not found then return; end if;

  with upserted as (
    insert into public.transactions (
      family_id, type, amount, amount_base, occurred_at, comment, created_by_member_id, paid_by_member_id,
      account_id, category_id, is_hold, source, external_id, rule_pending
    )
    select acc.family_id, case when i.amount < 0 then 'expense' else 'income' end::public.transaction_type,
      i.amount, i.amount, i.occurred_at, nullif(trim(i.comment), ''), acc.owner_member_id, acc.owner_member_id,
      acc.id, cat.id, i.hold, 'mono', i.external_id, true
    from jsonb_to_recordset(items) as i (external_id text, occurred_at timestamptz, amount bigint, hold boolean, comment text, category text)
      left join public.categories cat on cat.family_id = acc.family_id and cat.name = i.category
        and cat.kind = 'expense' and cat.archived_at is null
    where i.amount <> 0
      and not exists (select 1 from private.mono_deleted d where d.family_id = acc.family_id and d.external_id = i.external_id)
    on conflict (family_id, source, external_id) do update set
      is_hold = excluded.is_hold,
      -- У общей операции сумму не меняем: доли перестали бы сходиться. Холд в баланс всё равно не входит.
      amount = case when public.transactions.is_shared then public.transactions.amount else excluded.amount end,
      amount_base = case when public.transactions.is_shared then public.transactions.amount_base else excluded.amount_base end
    returning id
  )
  select array_agg(id) into touched from upserted;

  -- Сначала пары переводов: перевод не должен стать общей тратой по правилу.
  perform private.match_mono_transfers(touched);
  perform private.apply_share_rules(touched);

  update public.accounts set
    mono_page_to = next_page_to,
    mono_cursor = case
      when next_page_to is not null then mono_cursor
      when window_to >= now() - interval '1 minute' then now() - interval '3 days' -- догнали: дальше перечитываем хвост
      else window_to
    end
  where id = account;
end $$;
