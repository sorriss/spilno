-- Оплата долга через mono и автоматическое закрытие.
-- 1. Участник сохраняет свою ссылку «поповнення за посиланням» (send.monobank.ua/...): Spilno добавляет к ней ?a=сумма.
-- 2. Кнопка «Переказати в mono» сначала записывает намерение: кто, кому, сколько, когда.
-- 3. Импорт выписки ищет подтверждение: −X у плательщика или +X у получателя в течение суток после нажатия.
--    Хватает mono у одного из двоих. Найдено — операция становится внутренним переводом, долг закрывается расчётом.
-- Перевод без нажатия кнопки долг по-прежнему не закрывает: деньги переводят и по другим поводам.

alter table family_members add column mono_pay_link text
  check (mono_pay_link ~ '^https://send\.monobank\.ua/[A-Za-z0-9]+$');

create function set_pay_link(fam uuid, link text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.family_members set mono_pay_link = nullif(trim(link), '')
    where family_id = fam and user_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'not a family member' using errcode = 'insufficient_privilege';
  end if;
end $$;

create table payment_intents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  from_member_id uuid not null,
  to_member_id uuid not null,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  settlement_id uuid references settlements on delete set null, -- не null: перевод найден, долг закрыт
  transaction_id uuid references transactions on delete set null, -- перевод, которым закрыт долг
  -- false: перевод собран из одной стороны; вторая сторона, если придёт из выписки другого участника, — дубль.
  both_sides boolean not null default false,
  check (from_member_id <> to_member_id),
  foreign key (family_id, from_member_id) references family_members (family_id, id),
  foreign key (family_id, to_member_id) references family_members (family_id, id)
);
alter table payment_intents enable row level security;
create policy parties_read on payment_intents for select to authenticated
  using (private.member_id(family_id) in (from_member_id, to_member_id));
revoke all on payment_intents from anon, authenticated;
grant select on payment_intents to authenticated;

-- Платит должник, и не больше, чем должен он и чем должны получателю. Новое намерение заменяет прежнее к тому же получателю.
create function start_payment(fam uuid, to_member uuid, pay_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.member_id(fam);
  mine bigint;
  theirs bigint;
begin
  select balance into mine from public.member_balances where family_id = fam and member_id = me;
  select balance into theirs from public.member_balances where family_id = fam and member_id = to_member;
  if me is null or me = to_member or not (mine < 0 and theirs > 0 and pay_amount > 0 and pay_amount <= least(-mine, theirs)) then
    raise exception 'nothing to pay' using errcode = 'check_violation';
  end if;
  delete from public.payment_intents
    where from_member_id = me and to_member_id = to_member and settlement_id is null;
  insert into public.payment_intents (family_id, from_member_id, to_member_id, amount) values (fam, me, to_member, pay_amount);
end $$;

-- Пары переводов: вдобавок к паре «−X / +X» убираем дубль — вторую сторону перевода, собранного по намерению
-- из одной стороны, когда позже приходит выписка второго участника. Только такого перевода: иначе удалили бы
-- настоящий доход на ту же сумму от постороннего.
create or replace function private.match_mono_transfers(ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  o public.transactions;
  sender public.transactions;
  receiver public.transactions;
  half uuid;
begin
  for t in
    select * from public.transactions
    where id = any(ids) and source = 'mono' and not is_shared and type in ('expense', 'income')
  loop
    -- Строку могли удалить на прошлом шаге цикла как сторону получателя.
    continue when not exists (select 1 from public.transactions where id = t.id);

    select pi.id into half from public.payment_intents pi
      join public.transactions x on x.id = pi.transaction_id
      join public.accounts a on a.id = x.account_id
    where not pi.both_sides and x.family_id = t.family_id and x.amount = -abs(t.amount)
      and a.owner_member_id <> t.paid_by_member_id
      and (case when t.type = 'expense' then x.paid_by_member_id else x.to_member_id end) = t.paid_by_member_id
      and abs(extract(epoch from x.occurred_at - t.occurred_at)) <= 86400
    limit 1;
    if found then
      update public.payment_intents set both_sides = true where id = half;
      delete from public.transactions where id = t.id;
      continue;
    end if;

    select * into o from public.transactions x
    where x.family_id = t.family_id and x.source = 'mono' and not x.is_shared
      and x.type = case when t.type = 'expense' then 'income' else 'expense' end::public.transaction_type
      and x.amount = -t.amount
      and x.paid_by_member_id <> t.paid_by_member_id
      and abs(extract(epoch from x.occurred_at - t.occurred_at)) <= 86400
    order by abs(extract(epoch from x.occurred_at - t.occurred_at))
    limit 1;
    continue when not found;

    if t.type = 'expense' then
      sender := t; receiver := o;
    else
      sender := o; receiver := t;
    end if;
    update public.transactions set type = 'transfer', to_member_id = receiver.paid_by_member_id, category_id = null
      where id = sender.id;
    delete from public.transactions where id = receiver.id;
  end loop;
end $$;

-- Намерения: подтверждение в выписке закрывает долг. Возвращает закрытые расчёты для push получателю.
create function private.match_payment_intents(ids uuid[])
returns table (settlement_id uuid, from_member uuid, to_member uuid, amount bigint)
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  i public.payment_intents;
  payer uuid;
  payee uuid;
  s uuid;
begin
  for t in
    select * from public.transactions
    where id = any(ids) and source = 'mono' and not is_shared and type in ('expense', 'income', 'transfer')
  loop
    payer := case t.type when 'income' then null else t.paid_by_member_id end;
    payee := case t.type when 'transfer' then t.to_member_id when 'income' then t.paid_by_member_id else null end;

    select * into i from public.payment_intents x
    where x.family_id = t.family_id and x.settlement_id is null and x.amount = abs(t.amount)
      and (payer is null or x.from_member_id = payer)
      and (payee is null or x.to_member_id = payee)
      and t.occurred_at between x.created_at - interval '10 minutes' and x.created_at + interval '24 hours'
    order by x.created_at
    limit 1;
    continue when not found;

    -- Одна сторона: делаем из неё перевод плательщик → получатель. Сумма перевода хранится со знаком минус.
    update public.transactions set type = 'transfer', amount = -i.amount, amount_base = -i.amount,
        paid_by_member_id = i.from_member_id, to_member_id = i.to_member_id, category_id = null, rule_pending = false
      where id = t.id;
    insert into public.settlements (family_id, from_member_id, to_member_id, amount, kind)
      values (i.family_id, i.from_member_id, i.to_member_id, i.amount, 'paid')
      returning id into s;
    -- Перевод, уже склеенный из двух выписок, — обе стороны на месте.
    update public.payment_intents set settlement_id = s, transaction_id = t.id, both_sides = t.type = 'transfer'
      where id = i.id;

    settlement_id := s; from_member := i.from_member_id; to_member := i.to_member_id; amount := i.amount;
    return next;
  end loop;
end $$;

-- mono_import теперь возвращает закрытые расчёты: mono-sync шлёт по ним push получателю.
drop function mono_import(uuid, jsonb, timestamptz, timestamptz);
create function mono_import(account uuid, items jsonb, window_to timestamptz, next_page_to timestamptz)
returns table (settlement_id uuid, from_member uuid, to_member uuid, amount bigint)
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
      -- Сумму общей операции и перевода не меняем: у общей перестали бы сходиться доли, у перевода — знак.
      amount = case when public.transactions.is_shared or public.transactions.type = 'transfer'
        then public.transactions.amount else excluded.amount end,
      amount_base = case when public.transactions.is_shared or public.transactions.type = 'transfer'
        then public.transactions.amount_base else excluded.amount_base end
    returning id
  )
  select array_agg(id) into touched from upserted;

  -- Порядок важен: пары переводов, потом намерения оплатить, потом правила (они не трогают переводы).
  perform private.match_mono_transfers(touched);
  return query select * from private.match_payment_intents(touched);
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

revoke all on function set_pay_link(uuid, text) from public, anon;
grant execute on function set_pay_link(uuid, text) to authenticated;
revoke all on function start_payment(uuid, uuid, bigint) from public, anon;
grant execute on function start_payment(uuid, uuid, bigint) to authenticated;
revoke all on function mono_import(uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function mono_import(uuid, jsonb, timestamptz, timestamptz) to service_role;
