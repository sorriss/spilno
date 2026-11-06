import { supabase } from './supabase';

export type MemberRole = 'owner' | 'member' | 'viewer';

/** Участник текущего пользователя. */
export async function currentMember() {
  const db = supabase!;
  const { data: auth } = await db.auth.getUser();
  // ponytail: первая по дате семья пользователя; выбор активной добавить вместе с переключателем семей.
  const { data, error } = await db
    .from('family_members')
    .select('id, family_id, role, families(name)')
    .eq('user_id', auth.user!.id)
    .is('left_at', null)
    .order('joined_at')
    .limit(1)
    .single();
  if (error) throw error;
  return {
    id: data.id as string,
    familyId: data.family_id as string,
    role: data.role as MemberRole,
    familyName: (data.families as unknown as { name: string }).name,
  };
}
