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

let avatarSynced = false;

export const familyGuard: CanActivateFn = async () => {
  if (!supabase) return true;
  const router = inject(Router);
  const { data, error } = await supabase.from('family_members').select('id').is('left_at', null).limit(1);
  if (error) throw error;
  if (!data.length) return router.parseUrl('/family-setup');
  // Раз за запуск: фото Google копируется в семью (см. sync-avatar). Ошибка не мешает работе, останется буква.
  if (!avatarSynced) {
    avatarSynced = true;
    const { data: session } = await supabase.auth.getSession();
    const providers = (session.session?.user.app_metadata['providers'] as string[] | undefined) ?? [];
    if (providers.includes('google')) supabase.functions.invoke('sync-avatar').catch(() => undefined);
  }
  return true;
};
