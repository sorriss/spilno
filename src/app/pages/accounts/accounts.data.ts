import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { allMembers } from '../../core/transactions';

export type AccountKind = 'cash' | 'card' | 'mono';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  visible: boolean;
  ownerName: string;
}

export interface AccountsView {
  familyId: string;
  meId: string;
  canEdit: boolean;
  mine: Account[];
  /** Чужие счета, которые их владельцы открыли семье. */
  others: Account[];
}

interface AccountRow {
  id: string;
  name: string;
  kind: AccountKind;
  is_visible_to_family: boolean;
  owner_member_id: string;
}

export async function loadAccounts(): Promise<AccountsView> {
  const me = await currentMember();
  const [members, rows] = await Promise.all([
    allMembers(me.familyId),
    supabase!
      .from('accounts')
      .select('id, name, kind, is_visible_to_family, owner_member_id')
      .eq('family_id', me.familyId)
      .is('archived_at', null),
  ]);
  if (rows.error) throw rows.error;

  const accounts = (rows.data as AccountRow[])
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      visible: a.is_visible_to_family,
      ownerId: a.owner_member_id,
      ownerName: members.find((m) => m.id === a.owner_member_id)?.display_name ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  return {
    familyId: me.familyId,
    meId: me.id,
    canEdit: me.role !== 'viewer',
    mine: accounts.filter((a) => a.ownerId === me.id),
    others: accounts.filter((a) => a.ownerId !== me.id),
  };
}

export async function addAccount(
  familyId: string,
  ownerId: string,
  name: string,
  kind: AccountKind,
  visible: boolean,
): Promise<void> {
  const { error } = await supabase!.from('accounts').insert({
    family_id: familyId,
    owner_member_id: ownerId,
    name,
    kind,
    is_visible_to_family: visible,
  });
  if (error) throw error;
}

/** Без select RLS молча вернул бы успех, не изменив ни строки. */
export async function updateAccount(
  id: string,
  patch: { name?: string; is_visible_to_family?: boolean; archived_at?: string },
): Promise<void> {
  const { data, error } = await supabase!.from('accounts').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Account was not updated');
}
