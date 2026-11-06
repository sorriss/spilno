import { supabase } from '../../core/supabase';
import { uk } from '../../i18n/uk';

export async function sendCode(email: string): Promise<void> {
  const { error } = await supabase!.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase!.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export function signInErrorMessage(error: unknown): string {
  const { code, status } = error as { code?: string; status?: number };
  if (status === 429) return uk.signIn.errorRateLimit;
  if (code === 'otp_expired') return uk.signIn.errorBadCode;
  if (code === 'email_address_invalid') return uk.signIn.errorBadEmail;
  return uk.signIn.errorGeneric;
}
