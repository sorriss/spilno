import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { allMembers, Tx, TX_FIELDS, toTx, TxRow } from '../../core/transactions';
import { uk } from '../../i18n/uk';

export type TxFilter = 'all' | 'shared' | 'mine';

export interface Day {
  key: string;
  label: string;
  /** Сумма расходов за день, ≤ 0: доход и переводы расходом не считаем. */
  total: number;
  txs: Tx[];
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(date: Date, now: Date): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  const text = date.toLocaleDateString('uk-UA', options);
  if (dayKey(date) === dayKey(now)) return uk.transactions.today(text);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return dayKey(date) === dayKey(yesterday) ? uk.transactions.yesterday(text) : text;
}

/** Группирует уже отсортированные операции по локальному дню. */
export function groupByDay(txs: readonly Tx[], now: Date): Day[] {
  const days: Day[] = [];
  for (const tx of txs) {
    const date = new Date(tx.occurred_at);
    const key = dayKey(date);
    let day = days.at(-1);
    if (day?.key !== key) {
      day = { key, label: dayLabel(date, now), total: 0, txs: [] };
      days.push(day);
    }
    day.txs.push(tx);
    if (tx.type === 'expense') day.total += tx.amount_base;
  }
  return days;
}

/** ponytail: «Показати ще» просит больше строк с начала; при тысячах операций перейти на постраничную загрузку по дате. */
export async function loadTransactions(filter: TxFilter, limit: number): Promise<{ days: Day[]; hasMore: boolean }> {
  const db = supabase!;
  const me = await currentMember();
  let query = db.from('transactions').select(`${TX_FIELDS}, transaction_shares(count)`).eq('family_id', me.familyId);
  if (filter === 'shared') query = query.eq('is_shared', true);
  if (filter === 'mine') query = query.or(`paid_by_member_id.eq.${me.id},to_member_id.eq.${me.id}`);

  const [members, rows] = await Promise.all([
    allMembers(me.familyId),
    // На одну строку больше лимита: так видно, есть ли ещё. Сумма дня на границе страницы неполная, пока не дозагружена.
    query.order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(limit + 1),
  ]);
  if (rows.error) throw rows.error;

  const data = rows.data as unknown as (TxRow & { transaction_shares: { count: number }[] })[];
  const txs = data
    .slice(0, limit)
    .map(({ transaction_shares, ...row }) => toTx(row, transaction_shares[0]?.count ?? 0, members, me.id));
  return { days: groupByDay(txs, new Date()), hasMore: data.length > limit };
}
