import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, parseKopecks, settlementPlan, splitByWeights } from './money';

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

describe('parseKopecks', () => {
  it('понимает то, что вводят и что показывает formatMoney', () => {
    expect(parseKopecks('1248,60')).toBe(124860);
    expect(parseKopecks('1248.6')).toBe(124860);
    expect(parseKopecks('1248,')).toBe(124800);
    expect(parseKopecks('0,07')).toBe(7);
    expect(parseKopecks('19,99')).toBe(1999);
    expect(parseKopecks(formatMoney(124860))).toBe(124860);
    expect(parseKopecks('0')).toBe(0);
  });

  it('отклоняет всё остальное', () => {
    for (const bad of ['', 'абв', '1,234', '-5', '1,2,3', '1e5', '99999999999']) {
      expect(parseKopecks(bad)).toBeNull();
    }
  });
});

describe('splitByWeights', () => {
  it('остаток получают первые, сумма сходится', () => {
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeights(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(splitByWeights(124860, [2, 2, 1])).toEqual([49944, 49944, 24972]);
    expect(splitByWeights(101, [2, 1])).toEqual([68, 33]);
  });

  it('на крупных суммах и весах сумма долей равна сумме', () => {
    const total = 999999999999;
    const shares = splitByWeights(total, [999, 7, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
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
