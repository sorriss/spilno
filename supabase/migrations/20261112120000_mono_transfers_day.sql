-- Окно поиска пары перевода: 24 часа вместо 5 минут. Сторона получателя может прийти заметно позже,
-- например при переводе с другого банка. Ложная пара требует дохода на ту же сумму у другого участника,
-- поэтому риск растёт мало; из нескольких кандидатов по-прежнему берётся ближайший по времени.

create or replace function private.match_mono_transfers(ids uuid[]) returns void
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

-- Пары, которые раньше не сошлись из-за узкого окна.
select private.match_mono_transfers(array(select id from transactions where source = 'mono' and type = 'expense'));
