import { currentMember } from './family';
import { supabase } from './supabase';

const DAY = 86_400_000;

export interface RefundIncome {
  id: string;
  amount: number;
  occurredAt: string;
  comment: string | null;
}

export interface RefundExpense {
  id: string;
  /** Сумма из банка, копейки без знака: mono делит счёт от неё. */
  amount: number;
  /** Чистая сумма после уже привязанных возвратов, копейки без знака. */
  net: number;
  occurredAt: string;
  title: string;
}

export interface RefundSuggestion {
  income: RefundIncome;
  expense: RefundExpense;
}

/**
 * Пары «доход — трата», похожие на возврат через «Розділити рахунок»: доход пришёл в течение недели после траты
 * и равен её 1/2 … 1/10 (с точностью до копейки на часть). Из нескольких трат берём ближайшую по времени.
 * ponytail: эвристика по сумме; если mono начнёт отдавать отметку «Розділити рахунок», матчить по ней.
 */
export function matchRefunds(incomes: readonly RefundIncome[], expenses: readonly RefundExpense[]): RefundSuggestion[] {
  return incomes.flatMap((income) => {
    const at = Date.parse(income.occurredAt);
    const candidates = expenses.filter((e) => {
      const gap = at - Date.parse(e.occurredAt);
      if (gap < -3_600_000 || gap > 7 * DAY || income.amount >= e.net) return false;
      for (let parts = 2; parts <= 10; parts++) if (Math.abs(income.amount * parts - e.amount) <= parts) return true;
      return false;
    });
    const gap = (e: RefundExpense) => Math.abs(at - Date.parse(e.occurredAt));
    const expense = candidates.sort((a, b) => gap(a) - gap(b))[0];
    return expense ? [{ income, expense }] : [];
  });
}

export async function loadRefundSuggestions(): Promise<RefundSuggestion[]> {
  const db = supabase!;
  const me = await currentMember();
  const now = Date.now();
  const [incomes, expenses] = await Promise.all([
    db
      .from('transactions')
      .select('id, amount_base, occurred_at, comment')
      .eq('family_id', me.familyId)
      .eq('type', 'income')
      .eq('created_by_member_id', me.id)
      .is('refund_of', null)
      .eq('refund_dismissed', false)
      .gte('occurred_at', new Date(now - 14 * DAY).toISOString())
      .order('occurred_at', { ascending: false }),
    db
      .from('transactions')
      .select('id, amount_base, net_base, occurred_at, comment, categories(name)')
      .eq('family_id', me.familyId)
      .eq('type', 'expense')
      .eq('paid_by_member_id', me.id)
      .gte('occurred_at', new Date(now - 21 * DAY).toISOString()),
  ]);
  const failed = incomes.error ?? expenses.error;
  if (failed) throw failed;
  return matchRefunds(
    incomes.data!.map((r) => ({ id: r.id, amount: r.amount_base, occurredAt: r.occurred_at, comment: r.comment })),
    (expenses.data as unknown as { id: string; amount_base: number; net_base: number; occurred_at: string; comment: string | null; categories: { name: string } | null }[])
      .map((r) => ({
        id: r.id,
        amount: -r.amount_base,
        net: -r.net_base,
        occurredAt: r.occurred_at,
        title: r.comment ?? r.categories?.name ?? '',
      })),
  );
}

/** expenseId = null снимает связь. Доли траты пересчитывает база. */
export async function linkRefund(incomeId: string, expenseId: string | null): Promise<void> {
  await updateOwn(incomeId, { refund_of: expenseId });
}

/** «Ні» на подсказке: этот доход больше не предлагаем. */
export async function dismissRefund(incomeId: string): Promise<void> {
  await updateOwn(incomeId, { refund_dismissed: true });
}

/** Без select RLS молча вернул бы успех, не изменив ни строки. */
async function updateOwn(id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase!.from('transactions').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Transaction was not updated');
}
