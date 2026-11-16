-- Свой цвет участник меняет функцией, как и имя: прямой update дал бы заодно поменять себе роль.
create function set_my_color(fam uuid, color smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.family_members set color_index = color
    where family_id = fam and user_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'not a family member' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function set_my_color(uuid, smallint) from public, anon;
grant execute on function set_my_color(uuid, smallint) to authenticated;
