-- Своё имя меняем через функцию: политика на прямой update разрешила бы участнику заодно поменять себе роль.
create function rename_me(fam uuid, member_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.family_members set display_name = trim(member_name)
    where family_id = fam and user_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'not a family member' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function rename_me(uuid, text) from public, anon;
grant execute on function rename_me(uuid, text) to authenticated;

-- Счёт необязателен, поэтому параметр последний и со значением по умолчанию.
drop function add_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb);

create function add_transaction(
  fam uuid,
  tx_type public.transaction_type,
  tx_amount bigint,
  tx_occurred_at timestamptz,
  tx_comment text,
  category uuid,
  paid_by uuid,
  to_member uuid,
  mode public.split_mode,
  shares jsonb,
  account uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  tx uuid;
begin
  insert into public.transactions (
    family_id, type, amount, amount_base, occurred_at, comment, created_by_member_id,
    paid_by_member_id, to_member_id, category_id, account_id, is_shared, split_mode
  ) values (
    fam, tx_type, tx_amount, tx_amount, tx_occurred_at, tx_comment, private.member_id(fam),
    paid_by, to_member, category, account, mode is not null, mode
  ) returning id into tx;

  insert into public.transaction_shares (family_id, transaction_id, member_id, amount, weight)
    select fam, tx, s.member_id, s.amount, s.weight
    from jsonb_to_recordset(shares) as s (member_id uuid, amount bigint, weight integer);

  return tx;
end $$;

revoke all on function add_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb, uuid) from public, anon;
grant execute on function add_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb, uuid) to authenticated;
