const NBSP = ' ';
const MINUS = '−';

/**
 * Копейки → «1 248,60» с неразрывным пробелом в тысячах. Знак и валюту не добавляет.
 * trimZero убирает «,00», ненулевые копейки показывает всегда: скрывать их в суммах долга нельзя.
 */
export function formatAmount(kopecks: number, { trimZero = false } = {}): string {
  const abs = Math.abs(kopecks);
  const whole = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+$)/g, NBSP);
  const rest = abs % 100;
  return trimZero && rest === 0 ? whole : `${whole},${String(rest).padStart(2, '0')}`;
}

/**
 * «−1 248,60 ₴». Плюс только по запросу: перевод показывается вообще без знака.
 * ponytail: только гривна, валюту брать из families.base_currency, когда появится её смена.
 */
export function formatMoney(kopecks: number, { plus = false, trimZero = false } = {}): string {
  const sign = kopecks < 0 ? MINUS : plus && kopecks > 0 ? '+' : '';
  return `${sign}${formatAmount(kopecks, { trimZero })}${NBSP}₴`;
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
}

/**
 * Кто кому сколько должен перевести, чтобы обнулить балансы (+ тебе должны, − должен ты).
 * ponytail: жадно, крупнейший должник платит крупнейшему получателю. Даёт максимум n−1 перевод,
 * точный минимум NP-труден, а на размере семьи разницы почти не будет.
 */
export function settlementPlan(balances: readonly { memberId: string; balance: number }[]): Payment[] {
  const left = balances.filter((b) => b.balance !== 0).map((b) => ({ ...b }));
  const plan: Payment[] = [];
  while (true) {
    left.sort((a, b) => b.balance - a.balance);
    const creditor = left[0];
    const debtor = left[left.length - 1];
    if (!creditor || creditor.balance <= 0 || debtor.balance >= 0) return plan;
    const amount = Math.min(creditor.balance, -debtor.balance);
    plan.push({ from: debtor.memberId, to: creditor.memberId, amount });
    creditor.balance -= amount;
    debtor.balance += amount;
  }
}
