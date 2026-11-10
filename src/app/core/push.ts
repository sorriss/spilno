import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { supabase } from './supabase';

/**
 * ok — можно подписаться; install — iPhone в Safari: Web Push есть только у приложения на главном экране;
 * denied — пользователь запретил уведомления в настройках; unsupported — браузер не умеет или service worker выключен (dev).
 */
export type PushSupport = 'ok' | 'install' | 'denied' | 'unsupported';

export function pushSupport(sw: SwPush): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !matchMedia('(display-mode: standalone)').matches) return 'install';
  if (!sw.isEnabled || !('Notification' in window)) return 'unsupported';
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

/** Вызывать из нажатия: iOS спрашивает разрешение только в ответ на действие пользователя. */
export async function enablePush(sw: SwPush): Promise<void> {
  const sub = (await sw.requestSubscription({ serverPublicKey: environment.vapidPublicKey })).toJSON();
  const { error } = await supabase!.rpc('claim_push_subscription', {
    sub_endpoint: sub.endpoint,
    sub_p256dh: sub.keys!['p256dh'],
    sub_auth: sub.keys!['auth'],
  });
  if (error) throw error;
}

export async function disablePush(sw: SwPush): Promise<void> {
  const sub = await firstValueFrom(sw.subscription);
  if (sub) await supabase!.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sw.unsubscribe();
}

export type NotifyRequest =
  | { type: 'expense'; familyId: string; transactionId: string }
  | { type: 'remind'; familyId: string; memberId: string; amount: number };

/** Возвращает, на сколько устройств ушло уведомление (для «Нагадати»). */
export async function notify(request: NotifyRequest): Promise<number> {
  const { data, error } = await supabase!.functions.invoke('notify', { body: request });
  if (error) throw error;
  return (data as { sent?: number }).sent ?? 0;
}
