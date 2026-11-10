import { currentMember, MemberRole } from '../../core/family';
import { supabase } from '../../core/supabase';

export interface Rule {
  id: string;
  /** Название категории или null, если правило по магазину. */
  category: string | null;
  merchant: string | null;
  /** null: вся семья. */
  memberIds: string[] | null;
}

export interface RulesView {
  familyId: string;
  meId: string;
  role: MemberRole;
  rules: Rule[];
  members: { id: string; name: string; colorIndex: number }[];
  categories: { id: string; name: string }[];
}

interface RuleRow {
  id: string;
  merchant: string | null;
  member_ids: string[] | null;
  categories: { name: string } | null;
}

export async function loadRules(): Promise<RulesView> {
  const db = supabase!;
  const me = await currentMember();
  const [rules, members, categories] = await Promise.all([
    db.from('share_rules').select('id, merchant, member_ids, categories(name)').eq('member_id', me.id).order('created_at'),
    db
      .from('family_members')
      .select('id, display_name, color_index')
      .eq('family_id', me.familyId)
      .is('left_at', null)
      .order('joined_at'),
    db
      .from('categories')
      .select('id, name')
      .eq('family_id', me.familyId)
      .eq('kind', 'expense')
      .is('archived_at', null),
  ]);
  const failed = rules.error ?? members.error ?? categories.error;
  if (failed) throw failed;
  return {
    familyId: me.familyId,
    meId: me.id,
    role: me.role,
    rules: (rules.data as unknown as RuleRow[]).map((r) => ({
      id: r.id,
      category: r.categories?.name ?? null,
      merchant: r.merchant,
      memberIds: r.member_ids,
    })),
    members: members.data!.map((m) => ({ id: m.id, name: m.display_name, colorIndex: m.color_index })),
    categories: categories.data!.sort((a, b) => a.name.localeCompare(b.name, 'uk')),
  };
}

/** memberIds null: делить на всю семью, в том числе на тех, кто вступит позже. */
export async function addRule(rule: {
  familyId: string;
  meId: string;
  categoryId: string | null;
  merchant: string | null;
  memberIds: string[] | null;
}): Promise<void> {
  const { error } = await supabase!.from('share_rules').insert({
    family_id: rule.familyId,
    member_id: rule.meId,
    category_id: rule.categoryId,
    merchant: rule.merchant,
    member_ids: rule.memberIds,
  });
  if (error) throw error;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase!.from('share_rules').delete().eq('id', id);
  if (error) throw error;
}
