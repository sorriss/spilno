import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { supabase } from './supabase';

// inject() работает только до первого await.

export const authGuard: CanActivateFn = async () => {
  if (!supabase) return true;
  const router = inject(Router);
  const { data } = await supabase.auth.getSession();
  return data.session ? true : router.parseUrl('/welcome');
};

/** Экраны входа: с активной сессией на них делать нечего. */
export const guestGuard: CanActivateFn = async () => {
  if (!supabase) return true;
  const router = inject(Router);
  const { data } = await supabase.auth.getSession();
  return data.session ? router.parseUrl('/tabs/overview') : true;
};

export const familyGuard: CanActivateFn = async () => {
  if (!supabase) return true;
  const router = inject(Router);
  const { data, error } = await supabase.from('family_members').select('id').is('left_at', null).limit(1);
  if (error) throw error;
  return data.length ? true : router.parseUrl('/family-setup');
};
