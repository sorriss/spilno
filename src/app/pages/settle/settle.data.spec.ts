import { describe, expect, it } from 'vitest';
import { buildSettle, normalizePayLink, pairLabel, parseReceived, payUrl, SettleRows } from './settle.data';

const rows: SettleRows = {
  familyId: 'f',
  meId: 'a',
  members: [
    { id: 'a', display_name: 'Андрій', color_index: 0, left_at: null },
    { id: 'o', display_name: 'Олена', color_index: 1, left_at: null },
    { id: 'x', display_name: 'Колишній', color_index: 2, left_at: '2026-01-01' },
    { id: 'y', display_name: 'Боржник', color_index: 3, left_at: '2026-01-01' },
  ],
  balances: [
    { member_id: 'a', balance: 1000 },
    { member_id: 'o', balance: -700 },
    { member_id: 'x', balance: 0 },
    { member_id: 'y', balance: -300 },
  ],
  settlements: ['1', '2', '3', '4'].map((id) => ({
    id, from_member_id: 'o', to_member_id: id === '1' ? 'a' : 'x', amount: 100, kind: 'paid', created_at: '2026-11-01T12:00:00Z',
  })),
};

describe('buildSettle', () => {
  it('прячет вышедшего без долга и оставляет вышедшего с долгом', () => {
    expect(buildSettle(rows).balances.map((b) => b.member.id)).toEqual(['a', 'o', 'y']);
  });

  it('план гасит все балансы', () => {
    expect(buildSettle(rows).payments.map((p) => [p.from.id, p.to.id, p.amount])).toEqual([
      ['o', 'a', 700],
      ['y', 'a', 300],
    ]);
  });

  it('отменить может только получатель, в превью не больше трёх', () => {
    const view = buildSettle(rows);
    expect(view.recent.map((s) => s.canUndo)).toEqual([true, false, false]);
    expect(view.hasMore).toBe(true);
  });
});

describe('parseReceived', () => {
  it('принимает часть и весь долг в формате поля', () => {
    expect(parseReceived('840,00', 84000)).toBe(84000);
    expect(parseReceived('100', 84000)).toBe(10000);
    expect(parseReceived('1 248,60', 124860)).toBe(124860);
  });

  it('отклоняет ноль, мусор и больше долга', () => {
    for (const bad of ['0', '', 'абв', '840,01']) expect(parseReceived(bad, 84000)).toBeNull();
  });
});

describe('pairLabel', () => {
  const m = (id: string, name: string, isMe = false) => ({ id, name, colorIndex: 0, isMe });
  it('говорит «вам» и «Ви» про текущего участника', () => {
    expect(pairLabel(m('o', 'Олена'), m('a', 'Андрій', true))).toBe('Олена → вам');
    expect(pairLabel(m('a', 'Андрій', true), m('o', 'Олена'))).toBe('Ви → Олена');
    expect(pairLabel(m('o', 'Олена'), m('s', 'Софійка'))).toBe('Олена → Софійка');
  });
});

describe('ссылка mono', () => {
  it('сохраняется без суммы и параметров, чужие адреса не принимаются', () => {
    expect(normalizePayLink(' https://send.monobank.ua/3KfsToToeE?a=100.00 ')).toBe('https://send.monobank.ua/3KfsToToeE');
    expect(normalizePayLink('https://send.monobank.ua/3KfsToToeE')).toBe('https://send.monobank.ua/3KfsToToeE');
    expect(normalizePayLink('http://send.monobank.ua/3KfsToToeE')).toBeNull();
    expect(normalizePayLink('https://send.monobank.ua.evil.com/x')).toBeNull();
    expect(normalizePayLink('https://send.monobank.ua/jar/abc')).toBeNull();
  });

  it('сумма в гривнах с точкой, копейки всегда двумя цифрами', () => {
    expect(payUrl('https://send.monobank.ua/X', 124860)).toBe('https://send.monobank.ua/X?a=1248.60');
    expect(payUrl('https://send.monobank.ua/X', 5)).toBe('https://send.monobank.ua/X?a=0.05');
    expect(payUrl('https://send.monobank.ua/X', 100000)).toBe('https://send.monobank.ua/X?a=1000.00');
  });

  it('кнопка оплаты только у моих долгов и только при ссылке получателя', () => {
    const rows: SettleRows = {
      familyId: 'f',
      meId: 'a',
      members: [
        { id: 'a', display_name: 'Андрій', color_index: 0, left_at: null },
        { id: 'o', display_name: 'Олена', color_index: 1, left_at: null },
        { id: 'y', display_name: 'Яна', color_index: 2, left_at: null },
      ],
      balances: [
        { member_id: 'a', balance: -500 },
        { member_id: 'y', balance: -300 },
        { member_id: 'o', balance: 800 },
      ],
      settlements: [],
      payLinks: { o: 'https://send.monobank.ua/O' },
      pending: [{ to_member_id: 'o', amount: 500 }],
    };
    const payments = buildSettle(rows).payments.map((p) => [p.from.id, p.to.id, p.payUrl, p.pending]);
    expect(payments).toContainEqual(['a', 'o', 'https://send.monobank.ua/O?a=5.00', true]);
    expect(payments).toContainEqual(['y', 'o', null, false]);
  });
});
