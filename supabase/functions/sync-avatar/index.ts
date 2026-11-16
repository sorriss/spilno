// Копирует фото из Google-аккаунта в family_members.avatar: семья видит фото, а Google не видит, кто его смотрит.
// Вызывает клиент после входа. Выкладка: Supabase Dashboard → Edge Functions → sync-avatar, вставить этот файл целиком
// (Verify JWT включён). Секретов не нужно.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 28000; // в base64 это меньше 40 000 символов из check в базе

/** Только фото Google и сразу 96×96: «=s96-c» в конце ссылки Google обрезает фото в квадрат нужного размера. */
function googlePhoto(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return null;
  return `${url.origin}${url.pathname.replace(/=[^/]*$/, '')}=s96-c`;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth.user) return reply({ error: 'unauthorized' }, 401);

  const meta = auth.user.user_metadata ?? {};
  const url = googlePhoto(meta['avatar_url'] ?? meta['picture']);
  // Нет фото Google (вход по коду или через Apple) — оставляем как есть.
  if (!url) return reply({ avatar: false });

  const res = await fetch(url).catch(() => null);
  const type = res?.headers.get('content-type')?.split(';')[0] ?? '';
  if (!res?.ok || !TYPES.includes(type)) return reply({ avatar: false });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return reply({ avatar: false });

  const { error } = await admin
    .from('family_members')
    .update({ avatar: `data:${type};base64,${base64(bytes)}` })
    .eq('user_id', auth.user.id);
  if (error) return reply({ error: 'save failed' }, 500);
  return reply({ avatar: true });
});
