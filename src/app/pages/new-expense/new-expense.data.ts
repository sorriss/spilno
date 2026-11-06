import { currentMember, MemberRole } from '../../core/family';
import { parseKopecks, splitByWeights } from '../../core/money';
import { supabase } from '../../core/supabase';

export type TxType = 'expense' | 'income' | 'transfer';
export type SplitMode = 'equal' | 'shares' | 'amounts';

export interface NewExpenseData {
  familyId: string;
  meId: string;
  role: MemberRole;
  members: { id: string; name: string; colorIndex: number }[];
  categories: { id: string; name: string; kind: 'expense' | 'income' }[];
}

export interface ShareRow {
  memberId: string;
  on: boolean;
  weight: string;
  amount: string;
}

export interface Share {
  memberId: string;
  amount: number;
  weight: number | null;
}

/** Доли включённых участников. null: при текущем вводе посчитать нельзя. Суммами доля может быть любой, сверяет вызывающий. */
export function computeShares(total: number, mode: SplitMode, rows: readonly ShareRow[]): Share[] | null {
  const on = rows.filter((r) => r.on);
  if (mode === 'amounts') {
    const amounts = on.map((r) => parseKopecks(r.amount || '0'));
    if (amounts.includes(null)) return null;
    return on.map((r, i) => ({ memberId: r.memberId, amount: amounts[i]!, weight: null }));
  }
  const weights = mode === 'equal' ? on.map(() => 1) : on.map((r) => Number(r.weight));
  if (!on.length || weights.some((w) => !Number.isInteger(w) || w < 1 || w > 999)) return null;
  const amounts = splitByWeights(total, weights);
  return on.map((r, i) => ({ memberId: r.memberId, amount: amounts[i], weight: mode === 'shares' ? weights[i] : null }));
}

export async function loadNewExpense(): Promise<NewExpenseData> {
  const db = supabase!;
  const me = await currentMember();
  const [members, categories] = await Promise.all([
    db
      .from('family_members')
      .select('id, display_name, color_index')
      .eq('family_id', me.familyId)
      .is('left_at', null)
      .order('joined_at'),
    db.from('categories').select('id, name, kind').eq('family_id', me.familyId).is('archived_at', null),
  ]);
  const failed = members.error ?? categories.error;
  if (failed) throw failed;
  return {
    familyId: me.familyId,
    meId: me.id,
    role: me.role,
    members: members.data!.map((m) => ({ id: m.id, name: m.display_name, colorIndex: m.color_index })),
    categories: (categories.data as NewExpenseData['categories']).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
  };
}

export async function saveTransaction(tx: {
  familyId: string;
  type: TxType;
  /** Копейки, положительное число: знак зависит от типа операции. */
  amount: number;
  occurredAt: Date;
  comment: string | null;
  categoryId: string | null;
  paidBy: string;
  toMember: string | null;
  mode: SplitMode | null;
  shares: Share[];
}): Promise<void> {
  const { error } = await supabase!.rpc('add_transaction', {
    fam: tx.familyId,
    tx_type: tx.type,
    tx_amount: tx.type === 'income' ? tx.amount : -tx.amount,
    tx_occurred_at: tx.occurredAt.toISOString(),
    tx_comment: tx.comment,
    category: tx.categoryId,
    paid_by: tx.paidBy,
    to_member: tx.toMember,
    mode: tx.mode,
    // Нулевая доля запрещена схемой: например, 1 копейка на троих достаётся только первому.
    shares: tx.shares
      .filter((s) => s.amount > 0)
      .map((s) => ({ member_id: s.memberId, amount: s.amount, weight: s.weight })),
  });
  if (error) throw error;
}
