import { currentMember, MemberRole } from '../../core/family';
import { supabase } from '../../core/supabase';
import { uk } from '../../i18n/uk';

export type HistoryMonths = 1 | 3 | 12;

export interface MonoAccount {
  id: string;
  name: string;
  /** 0–100; 100: история загружена, дальше подтягиваются новые операции. */
  progress: number;
}

export interface MonoView {
  familyId: string;
  role: MemberRole;
  /** null: монобанк не подключён. */
  clientName: string | null;
  months: HistoryMonths;
  accounts: MonoAccount[];
}

const DAY = 24 * 3600 * 1000;

/**
 * Насколько счёт догнал историю. Догнавший счёт перечитывает последние 3 дня, поэтому курсор позже 5 дней назад
 * значит «готово». Окно, которое не влезло в одну страницу mono, курсор не двигает: прогресс стоит, пока дочитывается.
 */
export function importProgress(cursor: string | null, importFrom: string, now = Date.now()): number {
  if (!cursor) return 0;
  const at = new Date(cursor).getTime();
  if (at >= now - 5 * DAY) return 100;
  const from = new Date(importFrom).getTime();
  return Math.max(0, Math.min(99, Math.round(((at - from) / (now - from)) * 100)));
}

export async function loadMono(): Promise<MonoView> {
  const db = supabase!;
  const me = await currentMember();
  // Только разрешённые столбцы: secret_id клиенту закрыт, select('*') упал бы.
  const [connection, accounts] = await Promise.all([
    db.from('mono_connections').select('client_name, import_months, import_from').eq('member_id', me.id).maybeSingle(),
    db
      .from('accounts')
      .select('id, name, mono_cursor')
      .eq('owner_member_id', me.id)
      .eq('kind', 'mono')
      .not('external_id', 'is', null)
      .is('archived_at', null)
      .order('name'),
  ]);
  const failed = connection.error ?? accounts.error;
  if (failed) throw failed;
  const c = connection.data;
  return {
    familyId: me.familyId,
    role: me.role,
    clientName: c?.client_name ?? null,
    months: (c?.import_months ?? 1) as HistoryMonths,
    accounts: c
      ? accounts.data!.map((a) => ({ id: a.id, name: a.name, progress: importProgress(a.mono_cursor, c.import_from) }))
      : [],
  };
}

/** Токен уходит на сервер один раз и на клиенте не хранится. */
export async function connectMono(familyId: string, token: string): Promise<void> {
  const { error } = await supabase!.functions.invoke('mono-connect', { body: { familyId, token } });
  if (!error) return;
  const body = await (error as { context?: Response }).context?.json().catch(() => null);
  throw { code: body?.error ?? 'unknown' };
}

export async function setHistory(familyId: string, months: HistoryMonths): Promise<void> {
  const { error } = await supabase!.rpc('set_mono_history', { fam: familyId, months });
  if (error) throw error;
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
