import { supabase } from '../../core/supabase';
import { i18n } from '../../i18n';

export async function sendCode(email: string): Promise<void> {
  const { error } = await supabase!.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase!.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

/** Уходит со страницы на провайдера; вернётся на /tabs/overview, сессию из URL подхватит supabase-js. */
export async function signInWith(provider: 'google' | 'apple'): Promise<void> {
  const { error } = await supabase!.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${location.origin}/tabs/overview` },
  });
  if (error) throw error;
}

export function signInErrorMessage(error: unknown): string {
  const { code, status } = error as { code?: string; status?: number };
  if (status === 429) return i18n.signIn.errorRateLimit;
  if (code === 'otp_expired') return i18n.signIn.errorBadCode;
  if (code === 'email_address_invalid') return i18n.signIn.errorBadEmail;
  return i18n.signIn.errorGeneric;
}
