-- Импорт счетов одной семьи — по очереди. mono-sync обрабатывает счета параллельно, и когда обе стороны перевода
-- приходят в одну минуту, два mono_import не видят строки друг друга. С намерением оплатить каждый превращал свою
-- сторону в перевод «плательщик → получатель» по одному и тому же намерению: в списке два одинаковых перевода,
-- а долг закрыт дважды. Без намерения гонка могла вернуть удалённую сторону получателя как доход.
-- Блокировка на транзакцию: следующий импорт той же семьи ждёт и видит уже склеенное.

create or replace function mono_import(account uuid, items jsonb, window_to timestamptz, next_page_to timestamptz)
returns table (kind text, ref_id uuid, from_member uuid, to_member uuid, amount bigint, total bigint, label text)
language plpgsql security definer set search_path = '' as $$
declare
  acc public.accounts;
  touched uuid[];
begin
  select * into acc from public.accounts where id = account;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(acc.family_id::text, 0));

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
  return query
    select 'settled', m.settlement_id, m.from_member, m.to_member, m.amount, m.amount, null::text
    from private.match_payment_intents(touched) m;
  return query
    select 'shared', r.r_tx, r.r_payer, r.r_member, r.r_share, r.r_total, r.r_label
    from private.apply_share_rules(touched) r;

  update public.accounts set
    mono_page_to = next_page_to,
    mono_cursor = case
      when next_page_to is not null then mono_cursor
      when window_to >= now() - interval '1 minute' then now() - interval '3 days' -- догнали: дальше перечитываем хвост
      else window_to
    end
  where id = account;
end $$;

revoke all on function mono_import(uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function mono_import(uuid, jsonb, timestamptz, timestamptz) to service_role;
