import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';

export interface CategorySpend {
  /** null: без категории. */
  id: string | null;
  name: string | null;
  icon: string;
  colorIndex: number | null;
  amount: number;
}

export interface AnalyticsView {
  /** 6 месяцев, последний — выбранный. Копейки трат без знака. */
  trend: { month: Date; total: number }[];
  total: number;
  categories: CategorySpend[];
  /** Мои переводы в семью за месяц; в total не входят. 0 в виде «Сім’я». */
  transfers: number;
}

interface Line {
  month: string;
  category_id: string | null;
  kind: 'expense' | 'transfer';
  amount: number;
}

/** «2026-11-01» в локальном времени: toISOString сдвинул бы дату через UTC. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Суммирует строки analytics() в вид экрана. Отдельно от запроса, чтобы проверять без базы. */
export function summarize(
  lines: readonly Line[],
  month: Date,
  categories: readonly { id: string; name: string; icon: string; color_index: number }[],
): AnalyticsView {
  const key = isoDate(month);
  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(month.getFullYear(), month.getMonth() - 5 + i, 1);
    const k = isoDate(m);
    return { month: m, total: lines.filter((l) => l.kind === 'expense' && l.month === k).reduce((s, l) => s + l.amount, 0) };
  });
  const current = lines.filter((l) => l.month === key);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const spends = current
    .filter((l) => l.kind === 'expense')
    .map((l) => {
      const c = l.category_id ? byId.get(l.category_id) : undefined;
      return { id: l.category_id, name: c?.name ?? null, icon: c?.icon ?? 'pricetag-outline', colorIndex: c?.color_index ?? null, amount: l.amount };
    })
    .sort((a, b) => b.amount - a.amount);
  return {
    trend,
    total: trend[5].total,
    categories: spends,
    transfers: current.filter((l) => l.kind === 'transfer').reduce((s, l) => s + l.amount, 0),
  };
}

export async function loadAnalytics(month: Date, mine: boolean): Promise<AnalyticsView> {
  const db = supabase!;
  const me = await currentMember();
  const [lines, categories] = await Promise.all([
    db.rpc('analytics', {
      fam: me.familyId,
      mine,
      from_month: isoDate(new Date(month.getFullYear(), month.getMonth() - 5, 1)),
      to_month: isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 1)),
    }),
    // С архивными: старые траты могут быть в категории, которую потом убрали.
    db.from('categories').select('id, name, icon, color_index').eq('family_id', me.familyId),
  ]);
  const failed = lines.error ?? categories.error;
  if (failed) throw failed;
  return summarize(lines.data as Line[], month, categories.data!);
}
