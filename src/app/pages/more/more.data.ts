import { currentMember, MemberRole } from '../../core/family';
import { supabase } from '../../core/supabase';

export interface MoreView {
  name: string;
  colorIndex: number;
  role: MemberRole;
  familyName: string;
  members: { id: string; name: string; colorIndex: number }[];
  accounts: number;
  categories: number;
}

export async function loadMore(): Promise<MoreView> {
  const db = supabase!;
  const me = await currentMember();
  const [members, accounts, categories] = await Promise.all([
    db
      .from('family_members')
      .select('id, display_name, color_index')
      .eq('family_id', me.familyId)
      .is('left_at', null)
      .order('joined_at'),
    db
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('owner_member_id', me.id)
      .is('archived_at', null),
    db
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', me.familyId)
      .is('archived_at', null),
  ]);
  const failed = members.error ?? accounts.error ?? categories.error;
  if (failed) throw failed;

  const self = members.data!.find((m) => m.id === me.id)!;
  return {
    name: self.display_name,
    colorIndex: self.color_index,
    role: me.role,
    familyName: me.familyName,
    members: members.data!.map((m) => ({ id: m.id, name: m.display_name, colorIndex: m.color_index })),
    accounts: accounts.count ?? 0,
    categories: categories.count ?? 0,
  };
}
