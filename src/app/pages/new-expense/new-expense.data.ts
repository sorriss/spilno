import { currentMember, MemberRole } from '../../core/family';
import { parseKopecks, splitByWeights } from '../../core/money';
import { supabase } from '../../core/supabase';
import { i18n } from '../../i18n';

export type TxType = 'expense' | 'income' | 'transfer';
export type SplitMode = 'equal' | 'shares' | 'amounts';

export interface NewExpenseData {
  familyId: string;
  meId: string;
  /** Автор операции: при правке им может быть не текущий участник, а владелец правит чужую. */
  authorId: string;
  role: MemberRole;
  members: { id: string; name: string; colorIndex: number }[];
  categories: { id: string; name: string; kind: 'expense' | 'income' }[];
  /** Только свои счета: платить с чужого нельзя. При правке чужой операции пусто, счёт остаётся прежним. */
  accounts: { id: string; name: string }[];
  /** null: новая операция. */
  editing: EditTx | null;
}

export interface EditTx {
  id: string;
  type: TxType;
  /** Копейки без знака. */
  amount: number;
  occurredAt: string;
  comment: string | null;
  categoryId: string | null;
  accountId: string | null;
  paidBy: string;
  toMember: string | null;
  mode: SplitMode | null;
  shares: Share[];
}

type EditRow = {
  id: string;
  type: TxType;
  amount_base: number;
  occurred_at: string;
  comment: string | null;
  category_id: string | null;
  account_id: string | null;
  created_by_member_id: string;
  paid_by_member_id: string;
  to_member_id: string | null;
  split_mode: SplitMode | null;
  shares: { member_id: string; amount: number; weight: number | null }[];
};

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

/** Без id: новая операция. С id: правка; null, если операции нет или она недоступна. */
export async function loadNewExpense(id?: string): Promise<NewExpenseData | null> {
  const db = supabase!;
  const me = await currentMember();
  let tx: EditRow | null = null;
  if (id) {
    const { data, error } = await db
      .from('transactions')
      .select(
        'id, type, amount_base, occurred_at, comment, category_id, account_id, created_by_member_id, paid_by_member_id, to_member_id, split_mode, shares:transaction_shares(member_id, amount, weight)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    tx = data as unknown as EditRow;
  }
  const authorId = tx?.created_by_member_id ?? me.id;
  // Вышедшие участники остаются, если они в этой операции: иначе правка молча выкинула бы их долю.
  const involved = new Set([tx?.paid_by_member_id, tx?.to_member_id, ...(tx?.shares.map((s) => s.member_id) ?? [])]);
  // Архивные категория и счёт этой операции тоже остаются в списке, иначе сохранение их сбросило бы.
  const keep = (column: string | null | undefined) => (column ? `archived_at.is.null,id.eq.${column}` : 'archived_at.is.null');

  const [members, categories, accounts] = await Promise.all([
    db.from('family_members').select('id, display_name, color_index, left_at').eq('family_id', me.familyId).order('joined_at'),
    db.from('categories').select('id, name, kind').eq('family_id', me.familyId).or(keep(tx?.category_id)),
    authorId === me.id
      ? db.from('accounts').select('id, name').eq('owner_member_id', me.id).or(keep(tx?.account_id)).order('name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failed = members.error ?? categories.error ?? accounts.error;
  if (failed) throw failed;
  return {
    familyId: me.familyId,
    meId: me.id,
    authorId,
    role: me.role,
    members: members
      .data!.filter((m) => !m.left_at || involved.has(m.id))
      .map((m) => ({ id: m.id, name: m.display_name, colorIndex: m.color_index })),
    categories: (categories.data as NewExpenseData['categories']).sort((a, b) => a.name.localeCompare(b.name, i18n.locale)),
    accounts: accounts.data!,
    editing: tx && {
      id: tx.id,
      type: tx.type,
      amount: Math.abs(tx.amount_base),
      occurredAt: tx.occurred_at,
      comment: tx.comment,
      categoryId: tx.category_id,
      accountId: tx.account_id,
      paidBy: tx.paid_by_member_id,
      toMember: tx.to_member_id,
      mode: tx.split_mode,
      shares: tx.shares.map((s) => ({ memberId: s.member_id, amount: s.amount, weight: s.weight })),
    },
  };
}

/** Без id создаёт операцию, с id переписывает существующую вместе с долями. Возвращает id операции. */
export async function saveTransaction(tx: {
  id: string | null;
  familyId: string;
  type: TxType;
  /** Копейки, положительное число: знак зависит от типа операции. */
  amount: number;
  occurredAt: Date;
  comment: string | null;
  categoryId: string | null;
  accountId: string | null;
  paidBy: string;
  toMember: string | null;
  mode: SplitMode | null;
  shares: Share[];
}): Promise<string> {
  const params = {
    tx_type: tx.type,
    tx_amount: tx.type === 'income' ? tx.amount : -tx.amount,
    tx_occurred_at: tx.occurredAt.toISOString(),
    tx_comment: tx.comment,
    category: tx.categoryId,
    account: tx.accountId,
    paid_by: tx.paidBy,
    to_member: tx.toMember,
    mode: tx.mode,
    // Нулевая доля запрещена схемой: например, 1 копейка на троих достаётся только первому.
    shares: tx.shares
      .filter((s) => s.amount > 0)
      .map((s) => ({ member_id: s.memberId, amount: s.amount, weight: s.weight })),
  };
  const { data, error } = tx.id
    ? await supabase!.rpc('update_transaction', { tx: tx.id, ...params })
    : await supabase!.rpc('add_transaction', { fam: tx.familyId, ...params });
  if (error) throw error;
  return tx.id ?? (data as string);
}
