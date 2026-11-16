-- Закрыть долг по одной трате. Расчёт может ссылаться на трату (for_transaction_id): это пометка «за что»,
-- баланс считается как раньше, по сумме расчётов. Нужна только экрану «Розрахунки»: какие траты ещё открыты.

alter table settlements add column for_transaction_id uuid references transactions on delete set null;
alter table payment_intents add column for_transaction_id uuid references transactions on delete set null;
create index on settlements (for_transaction_id) where for_transaction_id is not null;

-- Ссылаться можно только на общую трату, которую оплатил получатель и в которой есть доля должника.
create function private.is_debt_share(fam uuid, tx uuid, debtor uuid, creditor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.transactions t join public.transaction_shares s on s.transaction_id = t.id
    where t.id = tx and t.family_id = fam and t.is_shared and t.paid_by_member_id = creditor
      and s.member_id = debtor and s.amount > 0
  )
$$;
revoke all on function private.is_debt_share(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.is_debt_share(uuid, uuid, uuid, uuid) to authenticated;

drop policy receiver_insert on settlements;
create policy receiver_insert on settlements for insert to authenticated
  with check (
    to_member_id = private.member_id(family_id)
    and (for_transaction_id is null or private.is_debt_share(family_id, for_transaction_id, from_member_id, to_member_id))
  );

-- Доля должника в трате минус расчёты, привязанные к этой трате. Расчёты без привязки здесь не учитываются:
-- клиент обрезает список текущим долгом пары, начиная со старых трат.
create view open_shares with (security_invoker = true) as
select * from (
  select t.family_id, t.id as transaction_id, s.member_id as from_member_id, t.paid_by_member_id as to_member_id,
    s.amount - coalesce((
      select sum(x.amount) from settlements x
      where x.for_transaction_id = t.id and x.from_member_id = s.member_id and x.to_member_id = t.paid_by_member_id
    ), 0)::bigint as amount,
    t.occurred_at, t.comment, c.name as category_name, c.icon as category_icon, c.color_index as category_color
  from transactions t
    join transaction_shares s on s.transaction_id = t.id
    left join categories c on c.id = t.category_id
  where t.is_shared and s.member_id <> t.paid_by_member_id and s.amount > 0
) o
where amount > 0;
grant select on open_shares to authenticated;

-- Намерение может нести трату; новое заменяет прежнее к тому же получателю за ту же трату (или без траты).
drop function start_payment(uuid, uuid, bigint);
create function start_payment(fam uuid, to_member uuid, pay_amount bigint, for_tx uuid default null) returns void
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
  if for_tx is not null and not private.is_debt_share(fam, for_tx, me, to_member) then
    raise exception 'not your share' using errcode = 'check_violation';
  end if;
  delete from public.payment_intents
    where from_member_id = me and to_member_id = to_member and settlement_id is null
      and for_transaction_id is not distinct from for_tx;
  insert into public.payment_intents (family_id, from_member_id, to_member_id, amount, for_transaction_id)
    values (fam, me, to_member, pay_amount, for_tx);
end $$;
revoke all on function start_payment(uuid, uuid, bigint, uuid) from public, anon;
grant execute on function start_payment(uuid, uuid, bigint, uuid) to authenticated;

-- Как в 20261116000000_mono_pay, только расчёт получает трату из намерения.
create or replace function private.match_payment_intents(ids uuid[])
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

    update public.transactions set type = 'transfer', amount = -i.amount, amount_base = -i.amount,
        paid_by_member_id = i.from_member_id, to_member_id = i.to_member_id, category_id = null, rule_pending = false
      where id = t.id;
    insert into public.settlements (family_id, from_member_id, to_member_id, amount, kind, for_transaction_id)
      values (i.family_id, i.from_member_id, i.to_member_id, i.amount, 'paid', i.for_transaction_id)
      returning id into s;
    update public.payment_intents set settlement_id = s, transaction_id = t.id, both_sides = t.type = 'transfer'
      where id = i.id;

    settlement_id := s; from_member := i.from_member_id; to_member := i.to_member_id; amount := i.amount;
    return next;
  end loop;
end $$;
