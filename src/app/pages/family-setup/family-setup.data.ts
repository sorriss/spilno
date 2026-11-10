import { supabase } from '../../core/supabase';
import { i18n } from '../../i18n';

export async function createFamily(familyName: string, memberName: string): Promise<void> {
  const { error } = await supabase!.rpc('create_family', { family_name: familyName, member_name: memberName });
  if (error) throw error;
}

export async function joinFamily(inviteCode: string, memberName: string): Promise<void> {
  const { data, error } = await supabase!.rpc('join_family', { invite_code: inviteCode, member_name: memberName });
  if (error) throw error;
  if (!data) throw { code: 'P0002' }; // код не найден, использован или истёк
}

export async function signOut(): Promise<void> {
  const { error } = await supabase!.auth.signOut();
  if (error) throw error;
}

export function familyErrorMessage(error: unknown): string {
  // 54000: join_family поднимает program_limit_exceeded после 10 неверных кодов за час.
  const code = (error as { code?: string }).code;
  if (code === 'P0002') return i18n.familySetup.errorBadInvite;
  if (code === '54000') return i18n.familySetup.errorTooManyInvites;
  return i18n.familySetup.errorGeneric;
}
