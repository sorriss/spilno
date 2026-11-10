-- Монобанк, часть 3: внутрисемейные переводы. Перевод между участниками приходит из mono дважды:
-- «−X» у отправителя и «+X» у получателя. Находим такую пару и оставляем одну операцию-перевод от отправителя
-- получателю: она не расход и не доход, в баланс не входит, видна всей семье. Сторона получателя удаляется
-- и попадает в mono_deleted, поэтому следующий опрос её не вернёт.
-- ponytail: пара — та же сумма у разных участников в пределах 5 минут; при двух одинаковых переводах подряд
-- берётся ближайший по времени. Ошибочную пару пользователь исправит правкой операции.

create function private.match_mono_transfers(ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  o public.transactions;
  sender public.transactions;
  receiver public.transactions;
begin
  for t in
    select * from public.transactions
    where id = any(ids) and source = 'mono' and not is_shared and type in ('expense', 'income')
  loop
    -- Строку могли удалить на прошлом шаге цикла как сторону получателя.
    continue when not exists (select 1 from public.transactions where id = t.id);

    select * into o from public.transactions x
    where x.family_id = t.family_id and x.source = 'mono' and not x.is_shared
      and x.type = case when t.type = 'expense' then 'income' else 'expense' end::public.transaction_type
      and x.amount = -t.amount
      and x.paid_by_member_id <> t.paid_by_member_id
      and abs(extract(epoch from x.occurred_at - t.occurred_at)) <= 300
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
      amount_base = case when public.transactions.is_shared then public.transactions.amount_base else excluded.amount_base end
    returning id
  )
  select array_agg(id) into touched from upserted;

  perform private.match_mono_transfers(touched);

  update public.accounts set
    mono_page_to = next_page_to,
    mono_cursor = case
      when next_page_to is not null then mono_cursor
      when window_to >= now() - interval '1 minute' then now() - interval '3 days' -- догнали: дальше перечитываем хвост
      else window_to
    end
  where id = account;
end $$;

-- Пары, которые уже импортированы до этой миграции.
select private.match_mono_transfers(array(select id from transactions where source = 'mono' and type = 'expense'));
