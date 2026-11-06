import { MemberRole, currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';

export interface Invite {
  code: string;
  expiresAt: Date;
}

export interface FamilyView {
  familyId: string;
  familyName: string;
  isOwner: boolean;
  members: { id: string; name: string; role: MemberRole; colorIndex: number; isMe: boolean; balance: number }[];
  /** Коды видит только владелец: у остальных всегда null. */
  invite: Invite | null;
}

export async function loadFamily(): Promise<FamilyView> {
  const db = supabase!;
  const me = await currentMember();
  const isOwner = me.role === 'owner';

  const [members, invite, balances] = await Promise.all([
    db
      .from('family_members')
      .select('id, display_name, role, color_index')
      .eq('family_id', me.familyId)
      .is('left_at', null)
      .order('joined_at'),
    isOwner ? activeInvite(me.familyId) : null,
    db.from('member_balances').select('member_id, balance').eq('family_id', me.familyId),
  ]);
  if (members.error) throw members.error;
  if (balances.error) throw balances.error;

  return {
    familyId: me.familyId,
    familyName: me.familyName,
    isOwner,
    invite,
    members: members.data.map((m) => ({
      id: m.id,
      name: m.display_name,
      role: m.role,
      colorIndex: m.color_index,
      isMe: m.id === me.id,
      balance: balances.data.find((b) => b.member_id === m.id)?.balance ?? 0,
    })),
  };
}

async function activeInvite(familyId: string): Promise<Invite | null> {
  const { data, error } = await supabase!
    .from('family_invites')
    .select('code, expires_at')
    .eq('family_id', familyId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data && { code: data.code, expiresAt: new Date(data.expires_at) };
}

/** Без select RLS молча вернул бы успех, не изменив ни строки. Менять участников может только владелец. */
async function updateMember(id: string, patch: { role?: MemberRole; left_at?: string }): Promise<void> {
  const { data, error } = await supabase!.from('family_members').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Member was not updated');
}

export const setMemberRole = (id: string, role: MemberRole) => updateMember(id, { role });
export const removeMember = (id: string) => updateMember(id, { left_at: new Date().toISOString() });

export async function createInvite(familyId: string): Promise<void> {
  const { error } = await supabase!.rpc('create_invite', { fam: familyId });
  if (error) throw error;
}
