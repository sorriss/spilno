-- Правка операции: поля и доли одной транзакцией, отложенный триггер сверяет сумму долей при коммите.
-- security invoker: править может тот же, кто удаляет (RLS: автор-участник или владелец), автор не меняется.
create function update_transaction(
  tx uuid,
  tx_type public.transaction_type,
  tx_amount bigint,
  tx_occurred_at timestamptz,
  tx_comment text,
  category uuid,
  paid_by uuid,
  to_member uuid,
  mode public.split_mode,
  shares jsonb,
  account uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  fam uuid;
begin
  update public.transactions set
    type = tx_type, amount = tx_amount, amount_base = tx_amount, occurred_at = tx_occurred_at,
    comment = tx_comment, category_id = category, account_id = account, paid_by_member_id = paid_by,
    to_member_id = to_member, is_shared = mode is not null, split_mode = mode
  where id = tx
  returning family_id into fam;
  if not found then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;

  delete from public.transaction_shares where transaction_id = tx;
  insert into public.transaction_shares (family_id, transaction_id, member_id, amount, weight)
    select fam, tx, s.member_id, s.amount, s.weight
    from jsonb_to_recordset(shares) as s (member_id uuid, amount bigint, weight integer);
end $$;

revoke all on function update_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb, uuid) from public, anon;
grant execute on function update_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb, uuid) to authenticated;
