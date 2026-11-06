import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { authGuard, guestGuard } from './guards';
import { supabase } from './supabase';

const run = (guard: typeof authGuard, session: object | null) => {
  vi.spyOn(supabase!.auth, 'getSession').mockResolvedValue({ data: { session } } as never);
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  ) as Promise<boolean | UrlTree>;
};

// В демо-режиме (supabase: null) клиента нет, а guards всегда пропускают.
describe.skipIf(!supabase)('guards', () => {
  it('authGuard без сессии ведёт на /welcome', async () => {
    expect(String(await run(authGuard, null))).toBe('/welcome');
    expect(await run(authGuard, {})).toBe(true);
  });

  it('guestGuard с сессией ведёт в приложение', async () => {
    expect(String(await run(guestGuard, {}))).toBe('/tabs/overview');
    expect(await run(guestGuard, null)).toBe(true);
  });
});
