import { supabase } from './supabase';

export interface MemberRow {
  id: string;
  display_name: string;
  color_index: number;
  left_at: string | null;
}

export interface Member {
  id: string;
  name: string;
  colorIndex: number;
  isMe: boolean;
}

/** Поля операции для строки списка. shareCount передаётся отдельно: экраны получают доли по-разному. */
export const TX_FIELDS =
  'id, type, amount_base, occurred_at, comment, is_shared, is_internal_transfer, split_mode, paid_by_member_id, to_member_id, categories(name, icon, color_index)';

export interface TxRow {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  amount_base: number;
  occurred_at: string;
  comment: string | null;
  is_shared: boolean;
  is_internal_transfer: boolean;
  split_mode: 'equal' | 'shares' | 'amounts' | null;
  paid_by_member_id: string;
  to_member_id: string | null;
  categories: { name: string; icon: string; color_index: number } | null;
}

export type Tx = Omit<TxRow, 'paid_by_member_id' | 'to_member_id'> & {
  paidBy: Member;
  to?: Member;
  shareCount: number;
};

/** Участники вместе с вышедшими: их операции остаются в истории. */
export async function allMembers(familyId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase!
    .from('family_members')
    .select('id, display_name, color_index, left_at')
    .eq('family_id', familyId)
    .order('joined_at');
  if (error) throw error;
  return data;
}

export function toMember(members: readonly MemberRow[], meId: string, id: string): Member {
  const row = members.find((m) => m.id === id);
  if (!row) throw new Error(`Unknown member ${id}`);
  return { id, name: row.display_name, colorIndex: row.color_index, isMe: id === meId };
}

export function toTx(row: TxRow, shareCount: number, members: readonly MemberRow[], meId: string): Tx {
  const { paid_by_member_id, to_member_id, ...tx } = row;
  return {
    ...tx,
    shareCount,
    paidBy: toMember(members, meId, paid_by_member_id),
    to: to_member_id ? toMember(members, meId, to_member_id) : undefined,
  };
}
