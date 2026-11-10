import { describe, expect, it } from 'vitest';
import { summarize } from './analytics.data';

const cats = [
  { id: 'food', name: 'Продукти', icon: 'cart-outline', color_index: 2 },
  { id: 'cafe', name: 'Кафе', icon: 'cafe-outline', color_index: 4 },
];

describe('summarize', () => {
  it('6 месяцев по порядку, выбранный последний; категории по убыванию; переводы отдельно', () => {
    const view = summarize(
      [
        { month: '2026-11-01', category_id: 'cafe', kind: 'expense', amount: 300 },
        { month: '2026-11-01', category_id: 'food', kind: 'expense', amount: 1000 },
        { month: '2026-11-01', category_id: null, kind: 'expense', amount: 50 },
        { month: '2026-11-01', category_id: null, kind: 'transfer', amount: 2000 },
        { month: '2026-07-01', category_id: 'food', kind: 'expense', amount: 700 },
      ],
      new Date(2026, 10, 1),
      cats,
    );
    expect(view.trend.map((t) => [t.month.getMonth(), t.total])).toEqual([
      [5, 0], [6, 700], [7, 0], [8, 0], [9, 0], [10, 1350],
    ]);
    expect(view.total).toBe(1350);
    expect(view.categories.map((c) => [c.name, c.amount])).toEqual([['Продукти', 1000], ['Кафе', 300], [null, 50]]);
    expect(view.transfers).toBe(2000);
  });

  it('месяцы через Новый год', () => {
    const view = summarize([{ month: '2025-12-01', category_id: 'food', kind: 'expense', amount: 5 }], new Date(2026, 1, 1), cats);
    expect(view.trend.map((t) => t.total)).toEqual([0, 0, 0, 5, 0, 0]); // вер, жов, лис, гру, січ, лют
  });
});
