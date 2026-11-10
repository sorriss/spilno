// Web Push: уведомления о новой общей трате и «Нагадати». Вызывает клиент от имени пользователя.
// Выкладка: Supabase Dashboard → Edge Functions → notify, вставить этот файл целиком (Verify JWT включён).
// Секреты (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Lang = 'uk' | 'en' | 'pl';

/** Тексты push на языке устройства получателя (push_subscriptions.lang). */
const texts = {
  uk: {
    sharedExpense: 'Спільна витрата',
    yourShare: (sum: string) => `ваша частка ${sum}`,
    reminds: (name: string) => `${name} нагадує про розрахунок`,
    transfer: (sum: string) => `Переказати ${sum}`,
  },
  en: {
    sharedExpense: 'Shared expense',
    yourShare: (sum: string) => `your share ${sum}`,
    reminds: (name: string) => `${name} reminds you to settle up`,
    transfer: (sum: string) => `Transfer ${sum}`,
  },
  pl: {
    sharedExpense: 'Wspólny wydatek',
    yourShare: (sum: string) => `twoja część ${sum}`,
    reminds: (name: string) => `${name} przypomina o rozliczeniu`,
    transfer: (sum: string) => `Do przelania: ${sum}`,
  },
};

type Message = { title: string; body: string; url: string };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** «1 248,60 ₴», как в приложении. */
function money(kopecks: number): string {
  const abs = Math.abs(kopecks);
  const whole = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+$)/g, ' ');
  const rest = abs % 100;
  return `${whole}${rest ? `,${String(rest).padStart(2, '0')}` : ''} ₴`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth.user) return reply({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const { data: me } = await admin
    .from('family_members')
    .select('id, family_id, display_name')
    .eq('user_id', auth.user.id)
    .eq('family_id', body.familyId ?? '')
    .is('left_at', null)
    .maybeSingle();
  if (!me) return reply({ error: 'forbidden' }, 403);

  if (body.type === 'expense') {
    // Только своя новая общая трата: уведомляем остальных участников деления.
    const { data: tx } = await admin
      .from('transactions')
      .select('id, amount_base, comment, is_shared, created_by_member_id, categories(name), transaction_shares(member_id, amount)')
      .eq('id', body.transactionId ?? '')
      .eq('family_id', me.family_id)
      .maybeSingle();
    if (!tx || !tx.is_shared || tx.created_by_member_id !== me.id) return reply({ error: 'forbidden' }, 403);
    const shares = tx.transaction_shares as { member_id: string; amount: number }[];
    const what = tx.comment ?? (tx.categories as { name: string } | null)?.name;
    // Своя доля в тексте у каждого своя, поэтому шлём каждому отдельно.
    await Promise.all(
      shares
        .filter((s) => s.member_id !== me.id)
        .map((s) =>
          send(admin, [s.member_id], (t) => ({
            title: `${me.display_name}: ${what ?? t.sharedExpense}`,
            body: `${money(tx.amount_base)} · ${t.yourShare(money(s.amount))}`,
            url: `/tabs/transactions/${tx.id}`,
          })),
        ),
    );
    return reply({ ok: true });
  }

  if (body.type === 'remind') {
    // Напоминать может только тот, кому должны, и не больше, чем реально должны.
    const { data: balances } = await admin
      .from('member_balances')
      .select('member_id, balance')
      .eq('family_id', me.family_id)
      .in('member_id', [me.id, body.memberId ?? '']);
    const mine = balances?.find((b) => b.member_id === me.id)?.balance ?? 0;
    const theirs = balances?.find((b) => b.member_id === body.memberId)?.balance ?? 0;
    const amount = Number(body.amount);
    if (!(mine > 0 && theirs < 0 && Number.isInteger(amount) && amount > 0 && amount <= Math.min(mine, -theirs))) {
      return reply({ error: 'forbidden' }, 403);
    }
    const sent = await send(admin, [body.memberId], (t) => ({
      title: t.reminds(me.display_name),
      body: t.transfer(money(amount)),
      url: '/tabs/settle',
    }));
    return reply({ ok: true, sent });
  }

  return reply({ error: 'bad_request' }, 400);
});

/**
 * Шлёт на все устройства участников, каждому на языке устройства; отписавшиеся устройства (404/410) удаляет.
 * Возвращает число доставок.
 */
async function send(
  admin: ReturnType<typeof createClient>,
  memberIds: string[],
  compose: (t: (typeof texts)[Lang]) => Message,
): Promise<number> {
  webpush.setVapidDetails('mailto:hello@spilno.cc', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const { data: members } = await admin.from('family_members').select('user_id').in('id', memberIds);
  const users = (members ?? []).map((m) => m.user_id);
  if (!users.length) return 0;
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, lang').in('user_id', users);

  let delivered = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      const message = compose(texts[s.lang as Lang] ?? texts.uk);
      // Формат Angular Service Worker: по нажатию открывает приложение на нужном экране.
      const payload = JSON.stringify({
        notification: {
          title: message.title,
          body: message.body,
          icon: '/icons/icon-192.png',
          data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: message.url } } },
        },
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error(status, e);
      }
    }),
  );
  return delivered;
}
