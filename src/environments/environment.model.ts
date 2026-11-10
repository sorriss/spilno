export interface Environment {
  supabase: { url: string; anonKey: string } | null;
  /** Публичный ключ VAPID для Web Push; секретная пара лежит в секретах Edge Function notify. */
  vapidPublicKey: string;
}
