import { describe, expect, it } from 'vitest';
import { matchRefunds, RefundExpense, RefundIncome } from './refunds';

const expense = (id: string, amount: number, occurredAt: string, net = amount): RefundExpense =>
  ({ id, amount, net, occurredAt, title: id });
const income = (id: string, amount: number, occurredAt: string): RefundIncome =>
  ({ id, amount, occurredAt, comment: null });

describe('matchRefunds', () => {
  const flakon = expense('flakon', 154000, '2026-11-10T19:00:00Z');
  const maman = expense('maman', 374400, '2026-11-08T20:00:00Z');

  it('находит половину, треть и долю с копейкой округления', () => {
    const pairs = matchRefunds(
      [income('half', 77000, '2026-11-10T21:00:00Z'), income('third', 124800, '2026-11-09T10:00:00Z'), income('odd', 51334, '2026-11-11T09:00:00Z')],
      [flakon, maman],
    );
    expect(pairs.map((p) => [p.income.id, p.expense.id])).toEqual([['half', 'flakon'], ['third', 'maman'], ['odd', 'flakon']]);
  });

  it('не предлагает доход до траты, через неделю, не кратный и не меньший чистой суммы', () => {
    const pairs = matchRefunds(
      [
        income('before', 77000, '2026-11-10T10:00:00Z'),
        income('late', 77000, '2026-11-18T19:00:01Z'),
        income('salary', 100000, '2026-11-11T10:00:00Z'),
      ],
      [flakon],
    );
    expect(pairs).toEqual([]);
    expect(matchRefunds([income('half', 77000, '2026-11-11T10:00:00Z')], [expense('flakon', 154000, '2026-11-10T19:00:00Z', 77000)])).toEqual([]);
  });

  it('из двух подходящих трат берёт ближайшую по времени', () => {
    const older = expense('older', 154000, '2026-11-05T19:00:00Z');
    const [pair] = matchRefunds([income('half', 77000, '2026-11-10T21:00:00Z')], [older, flakon]);
    expect(pair.expense.id).toBe('flakon');
  });
});
