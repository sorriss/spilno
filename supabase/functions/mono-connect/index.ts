// Проверяет токен монобанка и сохраняет подключение. Токен уходит в Vault и обратно не возвращается.
// Выкладка: Supabase Dashboard → Edge Functions → mono-connect, вставить этот файл целиком (Verify JWT включён).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Тип карты в mono → подпись счёта.
const cardNames: Record<string, string> = {
  black: 'Чорна',
  white: 'Біла',
  platinum: 'Platinum',
  iron: 'Iron',
  yellow: 'Жовта',
  fop: 'ФОП',
  eAid: 'єПідтримка',
};

interface MonoAccount {
  id: string;
  type: string;
  currencyCode: number;
  maskedPan: string[];
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth.user) return reply({ error: 'unauthorized' }, 401);

  const { token, familyId } = await req.json().catch(() => ({}));
  if (typeof token !== 'string' || !token.trim() || typeof familyId !== 'string') return reply({ error: 'bad_request' }, 400);

  const { data: member } = await admin
    .from('family_members')
    .select('id')
    .eq('family_id', familyId)
    .eq('user_id', auth.user.id)
    .is('left_at', null)
    .in('role', ['owner', 'member'])
    .maybeSingle();
  if (!member) return reply({ error: 'forbidden' }, 403);

  const mono = await fetch('https://api.monobank.ua/personal/client-info', { headers: { 'X-Token': token.trim() } });
  if (mono.status === 429) return reply({ error: 'rate_limit' }, 429);
  if (!mono.ok) return reply({ error: 'bad_token' }, 400);
  const info: { name: string; accounts: MonoAccount[] } = await mono.json();

  // ponytail: только гривневые счета (980); валютным нужен курс для amount_base.
  const accounts = info.accounts
    .filter((a) => a.currencyCode === 980)
    .map((a) => ({
      external_id: a.id,
      name: `mono · ${cardNames[a.type] ?? 'Картка'} ${a.maskedPan[0]?.slice(-4) ?? ''}`.trim(),
      currency: 'UAH',
    }));

  const { error } = await admin.rpc('mono_save_connection', {
    member: member.id,
    token: token.trim(),
    name: info.name,
    mono_accounts: accounts,
  });
  if (error) {
    console.error(error);
    return reply({ error: 'save_failed' }, 500);
  }
  return reply({ name: info.name, accounts: accounts.length });
});
