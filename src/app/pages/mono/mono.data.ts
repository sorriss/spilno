import { currentMember, MemberRole } from '../../core/family';
import { supabase } from '../../core/supabase';
import { uk } from '../../i18n/uk';

export interface MonoView {
  familyId: string;
  role: MemberRole;
  /** null: монобанк не подключён. */
  clientName: string | null;
}

export async function loadMono(): Promise<MonoView> {
  const me = await currentMember();
  // Только разрешённые столбцы: secret_id клиенту закрыт, select('*') упал бы.
  const { data, error } = await supabase!
    .from('mono_connections')
    .select('client_name')
    .eq('member_id', me.id)
    .maybeSingle();
  if (error) throw error;
  return { familyId: me.familyId, role: me.role, clientName: data?.client_name ?? null };
}

/** Токен уходит на сервер один раз и на клиенте не хранится. */
export async function connectMono(familyId: string, token: string): Promise<void> {
  const { error } = await supabase!.functions.invoke('mono-connect', { body: { familyId, token } });
  if (!error) return;
  const body = await (error as { context?: Response }).context?.json().catch(() => null);
  throw { code: body?.error ?? 'unknown' };
}

export async function disconnectMono(familyId: string): Promise<void> {
  const { error } = await supabase!.rpc('disconnect_mono', { fam: familyId });
  if (error) throw error;
}

export function monoErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'bad_token') return uk.mono.errorBadToken;
  if (code === 'rate_limit') return uk.mono.errorRateLimit;
  return uk.mono.errorGeneric;
}
