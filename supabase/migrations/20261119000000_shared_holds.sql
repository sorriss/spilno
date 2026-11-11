-- Общая операция считается в балансе и аналитике сразу, даже пока она холд. Сумму общей операции повторный
-- импорт и так не меняет, поэтому ожидание конца холда ничего не уточняло, а только прятало свежую общую трату
-- из «Розрахунків» и статистики на 1–3 дня. Личные холды по-прежнему не считаем.

create or replace view member_balances with (security_invoker = true) as
select m.family_id, m.id as member_id, coalesce(sum(l.delta), 0)::bigint as balance
from family_members m
left join (
  select paid_by_member_id as member_id, -amount_base as delta
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
    select t.occurred_at, t.category_id, 'expense' as kind, -t.amount_base as amount
      from public.transactions t
      where not mine and t.family_id = fam and t.type = 'expense' and t.is_shared
    union all
    select t.occurred_at, t.category_id, 'expense', -t.amount_base
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
