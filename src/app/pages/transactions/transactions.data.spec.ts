import { describe, expect, it } from 'vitest';
import { Tx } from '../../core/transactions';
import { groupByDay } from './transactions.data';

const NOW = new Date(2026, 10, 6, 15);
const tx = (id: string, type: Tx['type'], amount: number, date: Date) =>
  ({ id, type, amount_base: amount, occurred_at: date.toISOString() }) as Tx;

describe('groupByDay', () => {
  it('группирует по локальному дню и подписывает сегодня, вчера и прошлые даты', () => {
    const days = groupByDay(
      [
        tx('a', 'expense', -100, new Date(2026, 10, 6, 0, 30)),
        tx('b', 'expense', -50, new Date(2026, 10, 5, 23, 30)),
        tx('c', 'expense', -1, new Date(2026, 10, 3, 12)),
        tx('d', 'expense', -1, new Date(2025, 11, 31, 12)),
      ],
      NOW,
    );
    expect(days.map((d) => d.label)).toEqual([
      'Сьогодні, 6 листопада', 'Вчора, 5 листопада', '3 листопада', '31 грудня 2025 р.',
    ]);
  });

  it('вчера работает на границе месяца', () => {
    const [day] = groupByDay([tx('a', 'expense', -1, new Date(2026, 10, 30, 12))], new Date(2026, 11, 1, 9));
    expect(day.label).toBe('Вчора, 30 листопада');
  });

  it('в сумму дня входят только расходы', () => {
    const [day] = groupByDay(
      [
        tx('a', 'expense', -124860, new Date(2026, 10, 6, 14)),
        tx('b', 'transfer', -84000, new Date(2026, 10, 6, 13)),
        tx('c', 'income', 5000, new Date(2026, 10, 6, 12)),
      ],
      NOW,
    );
    expect(day.total).toBe(-124860);
    expect(day.txs).toHaveLength(3);
  });
});
