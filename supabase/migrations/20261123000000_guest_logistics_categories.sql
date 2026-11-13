-- Категории «Гості» и «Логістика»: в набор новой семьи и в уже созданные семьи (если такой ещё нет).

insert into categories (family_id, name, kind, icon, color_index)
select f.id, c.name, 'expense', c.icon, c.color_index
from families f
cross join (values ('Гості', 'people-outline', 2), ('Логістика', 'cube-outline', 1)) as c (name, icon, color_index)
where not exists (
  select 1 from categories x where x.family_id = f.id and x.kind = 'expense' and lower(x.name) = lower(c.name)
);

create or replace function create_family(family_name text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  fam uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  insert into public.families (name) values (family_name) returning id into fam;
  insert into public.family_members (family_id, user_id, display_name, role)
    values (fam, auth.uid(), member_name, 'owner');
  insert into public.categories (family_id, name, kind, icon, color_index)
  select fam, c.name, c.kind::public.category_kind, c.icon, c.color_index from (values
    ('Продукти', 'expense', 'cart-outline', 0),
    ('Кафе', 'expense', 'cafe-outline', 4),
    ('Комуналка', 'expense', 'home-outline', 1),
    ('Транспорт', 'expense', 'bus-outline', 0),
    ('Пальне', 'expense', 'car-outline', 3),
    ('Аптека', 'expense', 'medkit-outline', 2),
    ('Дім', 'expense', 'bed-outline', 1),
    ('Діти', 'expense', 'happy-outline', 4),
    ('Одяг', 'expense', 'shirt-outline', 3),
    ('Розваги', 'expense', 'film-outline', 3),
    ('Подорожі', 'expense', 'airplane-outline', 0),
    ('Подарунки', 'expense', 'gift-outline', 1),
    ('Гості', 'expense', 'people-outline', 2),
    ('Логістика', 'expense', 'cube-outline', 1),
    ('Інше', 'expense', 'pricetag-outline', 4),
    ('Зарплата', 'income', 'card-outline', 2)
  ) as c (name, kind, icon, color_index);
  return fam;
end $$;
