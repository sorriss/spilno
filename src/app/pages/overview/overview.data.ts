import { settlementPlan } from '../../core/money';
import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';

interface MemberRow {
  id: string;
  display_name: string;
  color_index: number;
  left_at: string | null;
}

interface RecentRow {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  amount_base: number;
  comment: string | null;
  is_shared: boolean;
  is_internal_transfer: boolean;
  split_mode: 'equal' | 'shares' | 'amounts' | null;
  paid_by_member_id: string;
  to_member_id: string | null;
  categories: { name: string; icon: string; color_index: number } | null;
  transaction_shares: { count: number }[];
}

/** Сырые данные экрана: одинаковой формы из Supabase и из демо. */
export interface OverviewRows {
  familyName: string;
  meId: string;
  members: MemberRow[];
  balances: { member_id: string; balance: number }[];
  monthShared: { paid_by_member_id: string; amount_base: number }[];
  recent: RecentRow[];
}

export interface Member {
  id: string;
  name: string;
  colorIndex: number;
  isMe: boolean;
}

export interface Overview {
  familyName: string;
  /** Имена текущих участников для подзаголовка; себя показываем именем, а не «Ви». */
  memberNames: string[];
  sharedTotal: number;
  spent: { member: Member; amount: number }[];
  myBalance: number;
  /** С кем нужно рассчитаться: при положительном балансе это должники, при отрицательном — кому должен я. */
  counterparties: { name: string; amount: number }[];
  recent: (Omit<RecentRow, 'paid_by_member_id' | 'to_member_id' | 'transaction_shares'> & {
    paidBy: Member;
    to?: Member;
    shareCount: number;
  })[];
}

function memberOf(rows: OverviewRows, id: string): Member {
  const row = rows.members.find((m) => m.id === id);
  if (!row) throw new Error(`Unknown member ${id}`);
  return { id, name: row.display_name, colorIndex: row.color_index, isMe: id === rows.meId };
}

export function buildOverview(rows: OverviewRows): Overview {
  const spentById = new Map<string, number>();
  for (const t of rows.monthShared) {
    spentById.set(t.paid_by_member_id, (spentById.get(t.paid_by_member_id) ?? 0) + Math.abs(t.amount_base));
  }
  const spent = [...spentById]
    .map(([id, amount]) => ({ member: memberOf(rows, id), amount }))
    .sort((a, b) => b.amount - a.amount);

  const plan = settlementPlan(rows.balances.map((b) => ({ memberId: b.member_id, balance: b.balance })));
  const counterparties = plan.flatMap((p) => {
    if (p.to === rows.meId) return [{ name: memberOf(rows, p.from).name, amount: p.amount }];
    if (p.from === rows.meId) return [{ name: memberOf(rows, p.to).name, amount: p.amount }];
    return [];
  });

  return {
    familyName: rows.familyName,
    memberNames: rows.members.filter((m) => !m.left_at).map((m) => m.display_name),
    sharedTotal: spent.reduce((sum, s) => sum + s.amount, 0),
    spent,
    myBalance: rows.balances.find((b) => b.member_id === rows.meId)?.balance ?? 0,
    counterparties,
    recent: rows.recent.map(({ paid_by_member_id, to_member_id, transaction_shares, ...t }) => ({
      ...t,
      paidBy: memberOf(rows, paid_by_member_id),
      to: to_member_id ? memberOf(rows, to_member_id) : undefined,
      shareCount: transaction_shares[0]?.count ?? 0,
    })),
  };
}

async function fetchRows(month: Date): Promise<OverviewRows> {
  const db = supabase!;
  const me = await currentMember();

  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const [members, balances, monthShared, recent] = await Promise.all([
    db.from('family_members').select('id, display_name, color_index, left_at').eq('family_id', me.familyId).order('joined_at'),
    db.from('member_balances').select('member_id, balance').eq('family_id', me.familyId),
    // ponytail: считаем на клиенте, упрётся в лимит PostgREST 1000 строк; при таком объёме заменить на view с суммами.
    db
      .from('transactions')
      .select('paid_by_member_id, amount_base')
      .eq('family_id', me.familyId)
      .eq('is_shared', true)
      .eq('is_hold', false)
      .gte('occurred_at', month.toISOString())
      .lt('occurred_at', nextMonth.toISOString()),
    db
      .from('transactions')
      .select(
        'id, type, amount_base, comment, is_shared, is_internal_transfer, split_mode, paid_by_member_id, to_member_id, categories(name, icon, color_index), transaction_shares(count)',
      )
      .eq('family_id', me.familyId)
      .order('occurred_at', { ascending: false })
      .limit(3),
  ]);
  const failed = members.error ?? balances.error ?? monthShared.error ?? recent.error;
  if (failed) throw failed;

  return {
    familyName: me.familyName,
    meId: me.id,
    members: members.data!,
    balances: balances.data!,
    monthShared: monthShared.data!,
    recent: recent.data as unknown as RecentRow[],
  };
}

const DEMO_ROWS: OverviewRows = {
  familyName: 'Наша сім’я',
  meId: 'a',
  members: [
    { id: 'a', display_name: 'Андрій', color_index: 0, left_at: null },
    { id: 'o', display_name: 'Олена', color_index: 1, left_at: null },
    { id: 's', display_name: 'Софійка', color_index: 2, left_at: null },
  ],
  balances: [
    { member_id: 'a', balance: 128500 },
    { member_id: 'o', balance: -84000 },
    { member_id: 's', balance: -44500 },
  ],
  monthShared: [
    { paid_by_member_id: 'a', amount_base: -912000 },
    { paid_by_member_id: 'o', amount_base: -786000 },
    { paid_by_member_id: 's', amount_base: -145000 },
  ],
  recent: [
    {
      id: '1', type: 'expense', amount_base: -124860, comment: null, is_shared: true, is_internal_transfer: false,
      split_mode: 'equal', paid_by_member_id: 'a', to_member_id: null,
      categories: { name: 'Продукти', icon: 'cart-outline', color_index: 0 }, transaction_shares: [{ count: 3 }],
    },
    {
      id: '2', type: 'expense', amount_base: -231000, comment: null, is_shared: true, is_internal_transfer: false,
      split_mode: 'equal', paid_by_member_id: 'o', to_member_id: null,
      categories: { name: 'Комуналка', icon: 'home-outline', color_index: 1 }, transaction_shares: [{ count: 2 }],
    },
    {
      id: '3', type: 'transfer', amount_base: -84000, comment: null, is_shared: false, is_internal_transfer: true,
      split_mode: null, paid_by_member_id: 'a', to_member_id: 'o', categories: null, transaction_shares: [],
    },
  ],
};

export const isDemo = !supabase;

export async function loadOverview(month: Date): Promise<Overview> {
  return buildOverview(supabase ? await fetchRows(month) : DEMO_ROWS);
}
