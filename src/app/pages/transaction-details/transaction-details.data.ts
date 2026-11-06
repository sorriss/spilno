import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { allMembers, Member, toMember, Tx, TX_FIELDS, toTx, TxRow } from '../../core/transactions';

export interface TxDetails {
  tx: Tx;
  /** null: без счёта или чужой счёт, скрытый от семьи. */
  accountName: string | null;
  shares: { member: Member; amount: number; weight: number | null }[];
  /** Совпадает с RLS: владелец или автор-участник. Сервер проверит всё равно. */
  canDelete: boolean;
}

type DetailsRow = TxRow & {
  created_by_member_id: string;
  accounts: { name: string } | null;
  shares: { member_id: string; amount: number; weight: number | null }[];
};

/** null: операции нет — её удалили, либо это чужая личная и RLS её не отдаёт. */
export async function loadDetails(id: string): Promise<TxDetails | null> {
  const db = supabase!;
  const me = await currentMember();
  const [members, row] = await Promise.all([
    allMembers(me.familyId),
    db
      .from('transactions')
      .select(`${TX_FIELDS}, created_by_member_id, accounts(name), shares:transaction_shares(member_id, amount, weight)`)
      .eq('id', id)
      .maybeSingle(),
  ]);
  if (row.error) throw row.error;
  if (!row.data) return null;

  const { shares, created_by_member_id, accounts, ...tx } = row.data as unknown as DetailsRow;
  return {
    tx: toTx(tx, shares.length, members, me.id),
    accountName: accounts?.name ?? null,
    shares: shares
      .map((s) => ({ member: toMember(members, me.id, s.member_id), amount: s.amount, weight: s.weight }))
      .sort((a, b) => b.amount - a.amount),
    canDelete: me.role === 'owner' || (me.role === 'member' && created_by_member_id === me.id),
  };
}

/** Доли удаляются каскадом. Без select RLS молча вернул бы успех, не удалив ни строки. */
export async function deleteTransaction(id: string): Promise<void> {
  const { data, error } = await supabase!.from('transactions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Transaction was not deleted');
}
