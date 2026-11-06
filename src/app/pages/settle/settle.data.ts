import { currentMember } from '../../core/family';
import { parseKopecks, settlementPlan } from '../../core/money';
import { supabase } from '../../core/supabase';
import { allMembers, Member, MemberRow, toMember } from '../../core/transactions';
import { uk } from '../../i18n/uk';
import { nameOf } from '../../shell/tx-row';

export type SettlementKind = 'paid' | 'forgiven';

export interface Settlement {
  id: string;
  from: Member;
  to: Member;
  amount: number;
  kind: SettlementKind;
  createdAt: Date;
  /** Отменить, как и подтвердить, может только получатель. */
  canUndo: boolean;
}

interface SettlementRow {
  id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  kind: SettlementKind;
  created_at: string;
}

export interface SettleRows {
  familyId: string;
  meId: string;
  members: MemberRow[];
  balances: { member_id: string; balance: number }[];
  settlements: SettlementRow[];
}

export interface SettleView {
  familyId: string;
  balances: { member: Member; balance: number }[];
  payments: { from: Member; to: Member; amount: number }[];
  recent: Settlement[];
  hasMore: boolean;
}

const RECENT = 3;
const FIELDS = 'id, from_member_id, to_member_id, amount, kind, created_at';

function toSettlement(row: SettlementRow, members: readonly MemberRow[], meId: string): Settlement {
  return {
    id: row.id,
    from: toMember(members, meId, row.from_member_id),
    to: toMember(members, meId, row.to_member_id),
    amount: row.amount,
    kind: row.kind,
    createdAt: new Date(row.created_at),
    canUndo: row.to_member_id === meId,
  };
}

export function buildSettle(rows: SettleRows): SettleView {
  const balanceOf = (id: string) => rows.balances.find((b) => b.member_id === id)?.balance ?? 0;
  const member = (id: string) => toMember(rows.members, rows.meId, id);
  return {
    familyId: rows.familyId,
    // Вышедшего показываем, только пока за ним остаётся долг.
    balances: rows.members
      .filter((m) => !m.left_at || balanceOf(m.id) !== 0)
      .map((m) => ({ member: member(m.id), balance: balanceOf(m.id) })),
    payments: settlementPlan(rows.balances.map((b) => ({ memberId: b.member_id, balance: b.balance }))).map((p) => ({
      from: member(p.from),
      to: member(p.to),
      amount: p.amount,
    })),
    recent: rows.settlements.slice(0, RECENT).map((s) => toSettlement(s, rows.members, rows.meId)),
    hasMore: rows.settlements.length > RECENT,
  };
}

export async function loadSettle(): Promise<SettleView> {
  const db = supabase!;
  const me = await currentMember();
  const [members, balances, settlements] = await Promise.all([
    allMembers(me.familyId),
    db.from('member_balances').select('member_id, balance').eq('family_id', me.familyId),
    db
      .from('settlements')
      .select(FIELDS)
      .eq('family_id', me.familyId)
      .order('created_at', { ascending: false })
      .limit(RECENT + 1),
  ]);
  const failed = balances.error ?? settlements.error;
  if (failed) throw failed;
  return buildSettle({
    familyId: me.familyId,
    meId: me.id,
    members,
    balances: balances.data!,
    settlements: settlements.data as SettlementRow[],
  });
}

/** ponytail: последние 200 без постраничной загрузки; у семьи столько расчётов наберётся за годы. */
export async function loadHistory(): Promise<Settlement[]> {
  const me = await currentMember();
  const [members, settlements] = await Promise.all([
    allMembers(me.familyId),
    supabase!
      .from('settlements')
      .select(FIELDS)
      .eq('family_id', me.familyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (settlements.error) throw settlements.error;
  return (settlements.data as SettlementRow[]).map((s) => toSettlement(s, members, me.id));
}

export async function addSettlement(
  familyId: string,
  fromId: string,
  toId: string,
  amount: number,
  kind: SettlementKind,
): Promise<void> {
  const { error } = await supabase!
    .from('settlements')
    .insert({ family_id: familyId, from_member_id: fromId, to_member_id: toId, amount, kind });
  if (error) throw error;
}

/** Без select RLS молча вернул бы успех, не удалив ни строки. */
export async function undoSettlement(id: string): Promise<void> {
  const { data, error } = await supabase!.from('settlements').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Settlement was not deleted');
}

/** Сколько реально получено. Больше долга нельзя: иначе должник и получатель поменялись бы местами. */
export function parseReceived(text: string, debt: number): number | null {
  const amount = parseKopecks(text);
  return amount && amount <= debt ? amount : null;
}

export function pairLabel(from: Member, to: Member): string {
  return `${nameOf(from)} → ${to.isMe ? uk.settle.toYou : to.name}`;
}
