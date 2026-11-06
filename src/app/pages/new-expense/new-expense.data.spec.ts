import { describe, expect, it } from 'vitest';
import { computeShares, ShareRow } from './new-expense.data';

const row = (memberId: string, over: Partial<ShareRow> = {}): ShareRow => ({
  memberId, on: true, weight: '1', amount: '', ...over,
});

describe('computeShares', () => {
  it('порівну: остаток получают первые, выключенные не участвуют', () => {
    const shares = computeShares(100, 'equal', [row('a'), row('b', { on: false }), row('c'), row('d')]);
    expect(shares?.map((s) => [s.memberId, s.amount])).toEqual([['a', 34], ['c', 33], ['d', 33]]);
  });

  it('частками: сохраняет веса и сумму', () => {
    const shares = computeShares(124860, 'shares', [row('a', { weight: '2' }), row('b', { weight: '2' }), row('c')]);
    expect(shares?.map((s) => s.weight)).toEqual([2, 2, 1]);
    expect(shares?.reduce((sum, s) => sum + s.amount, 0)).toBe(124860);
  });

  it('частками: неверный вес не считается', () => {
    for (const weight of ['', '0', '1.5', '-1', '1000']) {
      expect(computeShares(100, 'shares', [row('a', { weight })])).toBeNull();
    }
  });

  it('сумами: пустое поле равно нулю, мусор не считается', () => {
    expect(computeShares(100, 'amounts', [row('a', { amount: '1,00' }), row('b')])?.map((s) => s.amount)).toEqual([100, 0]);
    expect(computeShares(100, 'amounts', [row('a', { amount: 'абв' })])).toBeNull();
  });

  it('никого не выбрали: деление невозможно', () => {
    expect(computeShares(100, 'equal', [row('a', { on: false })])).toBeNull();
  });
});
