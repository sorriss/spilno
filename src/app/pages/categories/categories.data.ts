import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { i18n } from '../../i18n';

export type CategoryKind = 'expense' | 'income';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  colorIndex: number;
}

export interface CategoriesView {
  familyId: string;
  canEdit: boolean;
  categories: Category[];
}

export async function loadCategories(): Promise<CategoriesView> {
  const me = await currentMember();
  const { data, error } = await supabase!
    .from('categories')
    .select('id, name, kind, icon, color_index')
    .eq('family_id', me.familyId)
    .is('archived_at', null);
  if (error) throw error;
  return {
    familyId: me.familyId,
    canEdit: me.role !== 'viewer',
    categories: data
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind as CategoryKind, icon: c.icon, colorIndex: c.color_index }))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.locale)),
  };
}

/** ponytail: иконка по умолчанию и цвет по кругу; выбор добавим, если семьям этого будет не хватать. */
export async function addCategory(familyId: string, name: string, kind: CategoryKind, count: number): Promise<void> {
  const { error } = await supabase!
    .from('categories')
    .insert({ family_id: familyId, name, kind, color_index: count % 5 });
  if (error) throw error;
}

/** Без select RLS молча вернул бы успех, не изменив ни строки. */
export async function updateCategory(id: string, patch: { name?: string; archived_at?: string }): Promise<void> {
  const { data, error } = await supabase!.from('categories').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('Category was not updated');
}
