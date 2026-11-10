-- Аналитика: суммы трат по месяцам и категориям. Считает база: на клиенте упёрлись бы в лимит PostgREST в 1000 строк.
-- security invoker: работает RLS, чужие личные операции не видны и в суммы не попадают.
-- Сім’я — общие траты. Мої — мои личные траты и моя доля в общих; отдельно (kind = 'transfer') мои переводы в семью,
-- в итог трат они не входят: иначе деньги посчитались бы дважды, когда получатель их потратит.
-- Холды не считаем: сумма ещё не окончательная. Доходы не вычитаем.
-- ponytail: границы месяцев по Киеву; брать пояс из настроек семьи, когда появится выбор.
create function analytics(fam uuid, mine boolean, from_month date, to_month date)
returns table (month date, category_id uuid, kind text, amount bigint)
language sql stable security invoker set search_path = '' as $$
  with me as (select private.member_id(fam) as id),
  lines as (
    select t.occurred_at, t.category_id, 'expense' as kind, -t.amount_base as amount
      from public.transactions t
      where not mine and t.family_id = fam and t.type = 'expense' and t.is_shared and not t.is_hold
    union all
    select t.occurred_at, t.category_id, 'expense', -t.amount_base
      from public.transactions t, me
      where mine and t.family_id = fam and t.type = 'expense' and not t.is_shared and not t.is_hold
        and t.paid_by_member_id = me.id
    union all
    select t.occurred_at, t.category_id, 'expense', s.amount
      from public.transaction_shares s join public.transactions t on t.id = s.transaction_id, me
      where mine and t.family_id = fam and not t.is_hold and s.member_id = me.id
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

revoke all on function analytics(uuid, boolean, date, date) from public, anon;
grant execute on function analytics(uuid, boolean, date, date) to authenticated;
