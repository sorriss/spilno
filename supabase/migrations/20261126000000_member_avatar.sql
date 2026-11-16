-- Фото участника из Google: копия 96×96 прямо в строке участника (data:image/...), чтобы браузеры семьи
-- не ходили за ним к Google. Пишет только Edge Function sync-avatar (service role): с клиента колонку не обновить,
-- grant update на family_members — только перечисленные колонки.
alter table family_members add column avatar text
  check (avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(avatar) <= 40000);
