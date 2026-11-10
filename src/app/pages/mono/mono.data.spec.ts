import { describe, expect, it } from 'vitest';
import { importProgress } from './mono.data';

const DAY = 24 * 3600 * 1000;
const now = Date.UTC(2026, 10, 11);
const iso = (ms: number) => new Date(ms).toISOString();

describe('importProgress', () => {
  it('до первого запроса 0, на середине пути половина', () => {
    expect(importProgress(null, iso(now - 90 * DAY), now)).toBe(0);
    expect(importProgress(iso(now - 45 * DAY), iso(now - 90 * DAY), now)).toBe(50);
  });

  it('догнавший счёт перечитывает 3 дня — это уже 100', () => {
    expect(importProgress(iso(now - 3 * DAY), iso(now - 30 * DAY), now)).toBe(100);
  });

  it('почти догнал, но не готово — не больше 99', () => {
    expect(importProgress(iso(now - 6 * DAY), iso(now - 365 * DAY), now)).toBe(98);
    expect(importProgress(iso(now - 5.5 * DAY), iso(now - 30 * DAY), now)).toBeLessThanOrEqual(99);
  });
});
