-- Операция и её доли одной транзакцией: отложенный триггер проверяет их сумму при коммите.
-- security invoker: права и RLS те же, что при прямой записи, автор всегда текущий участник.
-- ponytail: только гривна, amount_base = amount; курс добавить вместе со счетами в других валютах.
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
  shares jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  tx uuid;
begin
  insert into public.transactions (
    family_id, type, amount, amount_base, occurred_at, comment, created_by_member_id,
    paid_by_member_id, to_member_id, category_id, is_shared, split_mode
  ) values (
    fam, tx_type, tx_amount, tx_amount, tx_occurred_at, tx_comment, private.member_id(fam),
    paid_by, to_member, category, mode is not null, mode
  ) returning id into tx;

  insert into public.transaction_shares (family_id, transaction_id, member_id, amount, weight)
    select fam, tx, s.member_id, s.amount, s.weight
    from jsonb_to_recordset(shares) as s (member_id uuid, amount bigint, weight integer);

  return tx;
end $$;

revoke all on function add_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb) from public, anon;
grant execute on function add_transaction(uuid, public.transaction_type, bigint, timestamptz, text, uuid, uuid, uuid, public.split_mode, jsonb) to authenticated;
