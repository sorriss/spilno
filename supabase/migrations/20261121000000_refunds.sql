-- Возврат части траты: доход (например, «Від: …» через «Розділити рахунок» в mono) ссылается на трату через refund_of.
-- У траты refunded — сумма привязанных возвратов, net_base — чистая сумма. По ней считаются доли, балансы и аналитика.
-- Возврат получает тот, кто платил: иначе чужие деньги уменьшили бы его трату, а баланс получателя не изменился бы.
-- Сам возврат остаётся личным доходом автора: семья видит только уменьшенную трату.

alter table transactions
  add column refund_of uuid,
  add column refunded bigint not null default 0,
  add column net_base bigint generated always as (amount_base + refunded) stored,
  add foreign key (family_id, refund_of) references transactions (family_id, id) on delete set null (refund_of),
  add check (refunded >= 0),
  -- Полный возврат — уже не трата, её проще удалить; заодно у общей не остаётся нулевых долей.
  add check (refunded = 0 or (type = 'expense' and refunded < -amount_base));
create index on transactions (refund_of) where refund_of is not null;

grant update (refund_of) on transactions to authenticated;

-- refunded пишет только триггер. Вставка разрешена на всю строку, поэтому новое значение сбрасываем здесь.
-- Возвратом может быть только доход: если сопоставление mono сделало из него перевод, связь снимается.
create function private.guard_refund() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.refunded := 0; end if;
  if new.type <> 'income' then new.refund_of := null; end if;
  return new;
end $$;

create trigger transactions_guard_refund before insert or update on transactions
  for each row execute function private.guard_refund();

-- Пересчитывает refunded траты и раскладывает чистую сумму по прежним долям. Вес: порівну — 1, частками — вес,
-- сумами — прежняя доля. Остаток копеек — по одной первым участникам в порядке вступления, как splitByWeights.
-- ponytail: у «сумами» после привязки и отвязки возможен сдвиг на копейку; хранить исходные суммы, если заметят.
-- security definer: долями общей траты распоряжается её автор, а возврат привязывает плательщик.
create function private.sync_refunded(expense uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e public.transactions;
  total bigint;
begin
  select coalesce(sum(amount_base), 0) into total from public.transactions where refund_of = expense;
  update public.transactions set refunded = total where id = expense and refunded <> total returning * into e;
  if not found or not e.is_shared then return; end if;

  with old as (
    delete from public.transaction_shares where transaction_id = expense returning member_id, amount, weight
  ), w as (
    select o.member_id, o.weight,
      case e.split_mode when 'amounts' then o.amount when 'shares' then o.weight else 1 end::numeric as w,
      row_number() over (order by m.joined_at, m.id) as n
    from old o join public.family_members m on m.id = o.member_id
  ), base as (
    select member_id, weight, n, floor(-e.net_base * w / sum(w) over ())::bigint as amount from w
  ), rescaled as (
    select member_id, weight, amount + case when n <= -e.net_base - sum(amount) over () then 1 else 0 end as amount
    from base
  )
  insert into public.transaction_shares (family_id, transaction_id, member_id, amount, weight)
    select e.family_id, expense, member_id, amount, weight from rescaled where amount > 0;
end $$;

create function private.on_refund_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.refund_of is not null then perform private.sync_refunded(old.refund_of); end if;
  if tg_op <> 'DELETE' and new.refund_of is not null
    and (tg_op = 'INSERT' or new.refund_of is distinct from old.refund_of or new.amount_base <> old.amount_base) then
    perform private.sync_refunded(new.refund_of);
  end if;
  return null;
end $$;

create trigger transactions_refunds after insert or update or delete on transactions
  for each row execute function private.on_refund_change();

create function private.check_refund() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.refund_of is not null and not exists (
    select 1 from public.transactions e
    where e.id = new.refund_of and e.type = 'expense' and e.paid_by_member_id = new.paid_by_member_id
  ) then
    raise exception 'refund must point to an expense paid by the same member' using errcode = 'check_violation';
  end if;
  if new.refunded > 0 and exists (
    select 1 from public.transactions r where r.refund_of = new.id and r.paid_by_member_id <> new.paid_by_member_id
  ) then
    raise exception 'refund must point to an expense paid by the same member' using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger transactions_refund_check after insert or update on transactions
  deferrable initially deferred for each row execute function private.check_refund();

-- Доли сверяются с чистой суммой.
create or replace function private.check_shares() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tx_id uuid;
  tx public.transactions;
  share_sum bigint;
  share_count bigint;
begin
  if tg_table_name = 'transactions' then
    tx_id := new.id;
  elsif tg_op = 'DELETE' then
    tx_id := old.transaction_id;
  else
    tx_id := new.transaction_id;
  end if;

  select * into tx from public.transactions where id = tx_id;
  if not found then return null; end if; -- операция удалена вместе с долями

  select coalesce(sum(amount), 0), count(*) into share_sum, share_count
  from public.transaction_shares where transaction_id = tx_id;

  if tx.is_shared and (share_count = 0 or share_sum <> abs(tx.net_base)) then
    raise exception 'shares sum % does not match transaction amount %', share_sum, abs(tx.net_base)
      using errcode = 'check_violation';
  end if;
  if not tx.is_shared and share_count > 0 then
    raise exception 'personal transaction cannot have shares' using errcode = 'check_violation';
  end if;
  return null;
end $$;

create or replace view member_balances with (security_invoker = true) as
select m.family_id, m.id as member_id, coalesce(sum(l.delta), 0)::bigint as balance
from family_members m
left join (
  select paid_by_member_id as member_id, -net_base as delta
    from transactions where is_shared
  union all
  select s.member_id, -s.amount
    from transaction_shares s
  union all
  select from_member_id, amount from settlements
  union all
  select to_member_id, -amount from settlements
) l on l.member_id = m.id
group by m.family_id, m.id;

create or replace function analytics(fam uuid, mine boolean, from_month date, to_month date)
returns table (month date, category_id uuid, kind text, amount bigint)
language sql stable security invoker set search_path = '' as $$
  with me as (select private.member_id(fam) as id),
  lines as (
    select t.occurred_at, t.category_id, 'expense' as kind, -t.net_base as amount
      from public.transactions t
      where not mine and t.family_id = fam and t.type = 'expense' and t.is_shared
    union all
    select t.occurred_at, t.category_id, 'expense', -t.net_base
      from public.transactions t, me
      where mine and t.family_id = fam and t.type = 'expense' and not t.is_shared and not t.is_hold
        and t.paid_by_member_id = me.id
    union all
    select t.occurred_at, t.category_id, 'expense', s.amount
      from public.transaction_shares s join public.transactions t on t.id = s.transaction_id, me
      where mine and t.family_id = fam and s.member_id = me.id
    union all
    select t.occurred_at, null, 'transfer', -t.amount_base
      from public.transactions t, me
      where mine and t.family_id = fam and t.type = 'transfer' and not t.is_hold and t.paid_by_member_id = me.id
  )
  select date_trunc('month', occurred_at at time zone 'Europe/Kyiv')::date, category_id, kind, sum(amount)::bigint
  from lines
  where occurred_at >= from_month::timestamp at time zone 'Europe/Kyiv'
    and occurred_at < to_month::timestamp at time zone 'Europe/Kyiv'
  group by 1, 2, 3
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
