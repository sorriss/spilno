import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, settlementPlan } from './money';

describe('formatMoney', () => {
  it('форматирует по правилам интерфейса', () => {
    expect(formatMoney(-124860)).toBe('−1 248,60 ₴');
    expect(formatMoney(5)).toBe('0,05 ₴');
    expect(formatMoney(100000, { plus: true })).toBe('+1 000,00 ₴');
    expect(formatMoney(0, { plus: true })).toBe('0,00 ₴');
    expect(formatMoney(123456789012)).toBe('1 234 567 890,12 ₴');
  });

  it('trimZero прячет только нулевые копейки', () => {
    expect(formatAmount(128500, { trimZero: true })).toBe('1 285');
    expect(formatAmount(128501, { trimZero: true })).toBe('1 285,01');
  });
});

describe('settlementPlan', () => {
  it('сводит балансы к нулю переводами от должников к получателям', () => {
    expect(
      settlementPlan([
        { memberId: 'a', balance: 128500 },
        { memberId: 'o', balance: -84000 },
        { memberId: 's', balance: -44500 },
      ]),
    ).toEqual([
      { from: 'o', to: 'a', amount: 84000 },
      { from: 's', to: 'a', amount: 44500 },
    ]);
  });

  it('один должник нескольким получателям', () => {
    expect(
      settlementPlan([
        { memberId: 'a', balance: 700 },
        { memberId: 'o', balance: 300 },
        { memberId: 's', balance: -1000 },
      ]),
    ).toEqual([
      { from: 's', to: 'a', amount: 700 },
      { from: 's', to: 'o', amount: 300 },
    ]);
  });

  it('нулевые балансы не дают переводов и входные данные не меняются', () => {
    const input = [{ memberId: 'a', balance: 0 }];
    expect(settlementPlan(input)).toEqual([]);
    expect(input[0].balance).toBe(0);
  });
});
