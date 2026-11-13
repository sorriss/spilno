import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { allMembers, Member, toMember, Tx, TX_FIELDS, toTx, TxRow } from '../../core/transactions';

export interface TxDetails {
  tx: Tx;
  /** null: без счёта или чужой счёт, скрытый от семьи. */
  accountName: string | null;
  shares: { member: Member; amount: number; weight: number | null }[];
  /** Править и удалять: совпадает с RLS, владелец или автор-участник. Сервер проверит всё равно. */
  canEdit: boolean;
  /** Сколько вернули по трате, копейки без знака. tx.amount_base — уже за вычетом. */
  refunded: number;
  /** Свои возвраты по этой трате: чужие личные доходы RLS не отдаёт. */
  refunds: Tx[];
  /** Возврат привязывает тот, кто платил: деньги вернулись ему. */
  canRefund: boolean;
  /** Этот доход — возврат за трату. */
  refundOf: { id: string; title: string } | null;
}

export interface RefundCandidate {
  id: string;
  amount: number;
  occurredAt: string;
  comment: string | null;
}

type DetailsRow = TxRow & {
  created_by_member_id: string;
  refunded: number;
  refund_of: string | null;
  accounts: { name: string } | null;
  shares: { member_id: string; amount: number; weight: number | null }[];
};

/** null: операции нет — её удалили, либо это чужая личная и RLS её не отдаёт. */
export async function loadDetails(id: string): Promise<TxDetails | null> {
  const db = supabase!;
  const me = await currentMember();
  const [members, row, refunds] = await Promise.all([
    allMembers(me.familyId),
    db
      .from('transactions')
      .select(`${TX_FIELDS}, created_by_member_id, refunded, refund_of, accounts(name), shares:transaction_shares(member_id, amount, weight)`)
      .eq('id', id)
      .maybeSingle(),
    db.from('transactions').select(TX_FIELDS).eq('refund_of', id).order('occurred_at'),
  ]);
  const failed = row.error ?? refunds.error;
  if (failed) throw failed;
  if (!row.data) return null;

  const { shares, created_by_member_id, accounts, refunded, refund_of, ...tx } = row.data as unknown as DetailsRow;
  let refundOf: TxDetails['refundOf'] = null;
  if (refund_of) {
    const { data, error } = await db.from('transactions').select('id, comment, categories(name)').eq('id', refund_of).maybeSingle();
    if (error) throw error;
    const target = data as unknown as { id: string; comment: string | null; categories: { name: string } | null } | null;
    if (target) refundOf = { id: target.id, title: target.comment ?? target.categories?.name ?? '' };
  }
  return {
    tx: toTx(tx, shares.length, members, me.id),
    accountName: accounts?.name ?? null,
    shares: shares
      .map((s) => ({ member: toMember(members, me.id, s.member_id), amount: s.amount, weight: s.weight }))
      .sort((a, b) => b.amount - a.amount),
    canEdit: me.role === 'owner' || (me.role === 'member' && created_by_member_id === me.id),
    refunded,
    refunds: (refunds.data as unknown as TxRow[]).map((r) => toTx(r, 0, members, me.id)),
    // Полный возврат схема не пускает: остаться должна хотя бы копейка.
    canRefund: tx.type === 'expense' && tx.paid_by_member_id === me.id && me.role !== 'viewer' && tx.amount_base < -1,
    refundOf,
  };
}

/** Свои непривязанные доходы, которые могут быть возвратом: с дня до траты, меньше её чистой суммы. */
export async function loadRefundCandidates(expense: Tx): Promise<RefundCandidate[]> {
  const me = await currentMember();
  const from = new Date(new Date(expense.occurred_at).getTime() - 86_400_000).toISOString();
  const { data, error } = await supabase!
    .from('transactions')
    .select('id, amount_base, occurred_at, comment')
    .eq('family_id', me.familyId)
    .eq('type', 'income')
    .eq('created_by_member_id', me.id)
    .is('refund_of', null)
    .gte('occurred_at', from)
    .lt('amount_base', -expense.amount_base)
    .order('occurred_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data.map((r) => ({ id: r.id, amount: r.amount_base, occurredAt: r.occurred_at, comment: r.comment }));
}

/** Возврат наличными или без операции в выписке: создаём доход сразу привязанным. */
export async function addManualRefund(expense: Tx, amount: number, comment: string): Promise<void> {
  const me = await currentMember();
  const { error } = await supabase!.from('transactions').insert({
    family_id: me.familyId,
    type: 'income',
    amount,
    amount_base: amount,
    created_by_member_id: me.id,
    paid_by_member_id: me.id,
    comment,
    refund_of: expense.id,
  });
  if (error) throw error;
}

/** Доли удаляются каскадом. Без select RLS молча вернул бы успех, не удалив ни строки. */
export async function deleteTransaction(id: string): Promise<void> {
  const { data, error } = await supabase!.from('transactions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Transaction was not deleted');
}
