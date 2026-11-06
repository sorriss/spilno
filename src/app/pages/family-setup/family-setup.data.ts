import { supabase } from '../../core/supabase';
import { uk } from '../../i18n/uk';

export async function createFamily(familyName: string, memberName: string): Promise<void> {
  const { error } = await supabase!.rpc('create_family', { family_name: familyName, member_name: memberName });
  if (error) throw error;
}

export async function joinFamily(inviteCode: string, memberName: string): Promise<void> {
  const { error } = await supabase!.rpc('join_family', { invite_code: inviteCode, member_name: memberName });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase!.auth.signOut();
  if (error) throw error;
}

export function familyErrorMessage(error: unknown): string {
  // P0002: join_family поднимает no_data_found, когда код не найден, использован или истёк.
  return (error as { code?: string }).code === 'P0002' ? uk.familySetup.errorBadInvite : uk.familySetup.errorGeneric;
}
