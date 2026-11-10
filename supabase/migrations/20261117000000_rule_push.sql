-- Push об общих тратах, которые создало правило при импорте mono: каждому участнику деления, кроме владельца карты,
-- со своей долей, как у ручных трат. Правила возвращают, кого уведомить, mono_import отдаёт это mono-sync вместе
-- с закрытыми долгами (kind = 'settled' | 'shared').
-- Заодно правило действует только на операции, совершённые после его создания. Раньше оно делило и старую
-- историю, если её догружали позже (например, при увеличении глубины), а с push это ещё и сотни уведомлений.

drop function private.apply_share_rules(uuid[]);
create function private.apply_share_rules(ids uuid[])
returns table (r_tx uuid, r_payer uuid, r_member uuid, r_share bigint, r_total bigint, r_label text)
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
      -- Только операции после создания правила: история, догруженная позже, правилом не делится.
      and t.occurred_at >= sr.created_at
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

    -- Кого уведомить: всех в делении, кроме владельца карты; у каждого своя доля.
    return query
      select t.id, t.paid_by_member_id, s.member_id, s.amount, abs(t.amount_base), coalesce(t.comment, c.name)
      from public.transaction_shares s left join public.categories c on c.id = t.category_id
      where s.transaction_id = t.id and s.member_id <> t.paid_by_member_id;
  end loop;
end $$;

drop function mono_import(uuid, jsonb, timestamptz, timestamptz);
create function mono_import(account uuid, items jsonb, window_to timestamptz, next_page_to timestamptz)
returns table (kind text, ref_id uuid, from_member uuid, to_member uuid, amount bigint, total bigint, label text)
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
