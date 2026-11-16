import { describe, expect, it } from 'vitest';
import { OverviewRows, buildOverview, kyivMonthStart } from './overview.data';

const rows: OverviewRows = {
  familyName: 'Сім’я',
  meId: 'o',
  members: [
    { id: 'a', display_name: 'Андрій', color_index: 0, left_at: null },
    { id: 'o', display_name: 'Олена', color_index: 1, left_at: null },
    { id: 's', display_name: 'Софійка', color_index: 2, left_at: null },
    { id: 'x', display_name: 'Колишній', color_index: 3, left_at: '2026-01-01' },
  ],
  balances: [
    { member_id: 'a', balance: 128500 },
    { member_id: 'o', balance: -84000 },
    { member_id: 's', balance: -44500 },
  ],
  monthShares: [
    { member_id: 'a', amount: 100 },
    { member_id: 'x', amount: 300 },
    { member_id: 'a', amount: 50 },
    { member_id: 's', amount: 0 },
  ],
  recent: [],
};

describe('buildOverview', () => {
  it('суммирует доли по участникам, включая ушедших, от большей к меньшей, без нулевых', () => {
    const o = buildOverview(rows);
    expect(o.sharedTotal).toBe(450);
    expect(o.spent.map((s) => [s.member.id, s.amount])).toEqual([['x', 300], ['a', 150]]);
    expect(o.memberNames).toEqual(['Андрій', 'Олена', 'Софійка']);
  });

  it('должнику показывает только его долг, без чужих', () => {
    const o = buildOverview(rows);
    expect(o.myBalance).toBe(-84000);
    expect(o.counterparties).toEqual([{ name: 'Андрій', amount: 84000 }]);
  });

  it('при нулевом балансе не с кем рассчитываться', () => {
    const o = buildOverview({ ...rows, balances: [] });
    expect(o.myBalance).toBe(0);
    expect(o.counterparties).toEqual([]);
  });
});

describe('kyivMonthStart', () => {
  it('полночь по Києву: зимой UTC+2, летом UTC+3, декабрь переходит в январь', () => {
    expect(kyivMonthStart(2026, 10).toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(kyivMonthStart(2026, 6).toISOString()).toBe('2026-06-30T21:00:00.000Z');
    expect(kyivMonthStart(2026, 12).toISOString()).toBe('2026-12-31T22:00:00.000Z');
  });
});
