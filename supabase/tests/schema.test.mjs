// Прогоняет миграцию на PGlite (Postgres в процессе, без Docker) и проверяет инварианты денег и RLS.
// Запуск: npm run test:db
import { readFileSync, readdirSync } from 'node:fs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ANDRII = '00000000-0000-4000-8000-00000000000a';
const OLENA = '00000000-0000-4000-8000-00000000000b';
const SOFIA = '00000000-0000-4000-8000-00000000000c';
const STRANGER = '00000000-0000-4000-8000-00000000000d';

/** Выполняет sql от имени пользователя, как PostgREST: роль authenticated и sub в JWT. */
async function as(user, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

/** То же для нескольких выражений в одной транзакции БД. Возвращает ошибку наружу. */
async function txAs(user, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    await db.exec(`begin; ${sql}; commit;`);
  } catch (e) {
    await db.exec('rollback;');
    throw e;
  } finally {
    await db.exec('reset role;');
  }
}

let fam, andrii, olena, sofia;

async function memberId(user) {
  return (await db.query('select id from family_members where user_id = $1', [user])).rows[0].id;
}

function sharedExpense(id, { paidBy, total, shares }) {
  return `
    insert into transactions (id, family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, is_shared, split_mode)
      values ('${id}', '${fam}', 'expense', ${-total}, ${-total}, '${paidBy}', '${paidBy}', true, 'equal');
    insert into transaction_shares (family_id, transaction_id, member_id, amount) values
      ${shares.map(([m, a]) => `('${fam}', '${id}', '${m}', ${a})`).join(',')}`;
}

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public, auth to anon, authenticated, service_role;
    -- Заглушка Supabase Vault: в настоящем секреты шифруются, интерфейс тот же.
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
    create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text) returns uuid language sql as
      $$ insert into vault.secrets (secret) values (new_secret) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as
      $$ update vault.secrets set secret = new_secret where id = secret_id $$;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values ('${ANDRII}'), ('${OLENA}'), ('${SOFIA}'), ('${STRANGER}');
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }

  [{ fam }] = await as(ANDRII, `select create_family('Наша сім’я', 'Андрій') as fam`);
  const [{ code }] = await as(ANDRII, `select create_invite($1) as code`, [fam]);
  const [{ code: viewerCode }] = await as(ANDRII, `select create_invite($1, 'viewer') as code`, [fam]);
  await as(OLENA, `select join_family($1, 'Олена')`, [code]);
  await as(SOFIA, `select join_family($1, 'Софійка')`, [viewerCode.toLowerCase()]);
  andrii = await memberId(ANDRII);
  olena = await memberId(OLENA);
  sofia = await memberId(SOFIA);
});

test('create_family: владелец и 14 категорий', async () => {
  const [{ role }] = await as(ANDRII, 'select role from family_members where id = $1', [andrii]);
  assert.equal(role, 'owner');
  const cats = await as(ANDRII, 'select id from categories where family_id = $1', [fam]);
  assert.equal(cats.length, 14);
});

test('приглашение одноразовое и неверный код не проходит', async () => {
  const [{ code }] = await as(ANDRII, 'select create_invite($1) as code', [fam]);
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  await as(STRANGER, `select join_family($1, 'Гість')`, [code]);
  const [{ joined }] = await as(OLENA, `select join_family($1, 'Олена') as joined`, [code]);
  assert.equal(joined, null);
  await db.exec(`delete from family_members where user_id = '${STRANGER}'`);
});

test('после 10 неверных кодов за час вход по коду блокируется', async () => {
  const [{ code }] = await as(ANDRII, 'select create_invite($1) as code', [fam]);
  for (let i = 0; i < 10; i++) await as(STRANGER, `select join_family('WRONG', 'Гість')`);
  await assert.rejects(as(STRANGER, `select join_family($1, 'Гість')`, [code]), /too many invite attempts/);
  await db.exec(`update private.invite_attempts set at = now() - interval '2 hours' where user_id = '${STRANGER}'`);
  const [{ joined }] = await as(STRANGER, `select join_family($1, 'Гість') as joined`, [code]);
  assert.equal(joined, fam);
  await db.exec(`delete from family_members where user_id = '${STRANGER}'`);
});

test('свой код не меняет роль действующего участника', async () => {
  const [{ code }] = await as(ANDRII, `select create_invite($1, 'viewer') as code`, [fam]);
  await as(ANDRII, `select join_family($1, 'Андрій')`, [code]);
  const [{ role }] = await as(ANDRII, 'select role from family_members where id = $1', [andrii]);
  assert.equal(role, 'owner');
});

test('приглашать может только владелец', async () => {
  await assert.rejects(as(OLENA, 'select create_invite($1)', [fam]), /only owner/);
});

test('сумма долей обязана равняться сумме операции', async () => {
  await assert.rejects(
    txAs(ANDRII, sharedExpense('10000000-0000-4000-8000-000000000001', {
      paidBy: andrii, total: 1000, shares: [[andrii, 500], [olena, 499]],
    })),
    /does not match/,
  );
  await assert.rejects(
    txAs(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, is_shared, split_mode)
      values ('${fam}', 'expense', -100, -100, '${andrii}', '${andrii}', true, 'equal')`),
    /does not match/,
  );
});

test('нельзя сослаться на участника чужой семьи', async () => {
  const [{ other }] = await as(STRANGER, `select create_family('Чужа', 'Гість') as other`);
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -1, -1, $2, $2)`, [other, andrii]));
});

test('неверный знак суммы отклоняется', async () => {
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', 100, 100, $2, $2)`, [fam, andrii]));
});

test('баланс: общая трата, внутренний перевод не считается, частичный расчёт уменьшает долг', async () => {
  await txAs(ANDRII, sharedExpense('20000000-0000-4000-8000-000000000001', {
    paidBy: andrii, total: 124860, shares: [[andrii, 41620], [olena, 41620], [sofia, 41620]],
  }));
  await as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, to_member_id)
    values ($1, 'transfer', -84000, -84000, $2, $2, $3)`, [fam, andrii, olena]);

  const balances = async () => Object.fromEntries(
    (await as(ANDRII, 'select member_id, balance from member_balances where family_id = $1', [fam]))
      .map((r) => [r.member_id, Number(r.balance)]),
  );
  let b = await balances();
  assert.equal(b[andrii], 83240);
  assert.equal(b[olena], -41620);
  assert.equal(b[sofia], -41620);
  assert.equal(b[andrii] + b[olena] + b[sofia], 0);

  await as(ANDRII, `insert into settlements (family_id, from_member_id, to_member_id, amount) values ($1, $2, $3, 20000)`,
    [fam, olena, andrii]);
  b = await balances();
  assert.equal(b[andrii], 63240);
  assert.equal(b[olena], -21620);
});

test('подтвердить расчёт может только получатель', async () => {
  await assert.rejects(as(OLENA, `insert into settlements (family_id, from_member_id, to_member_id, amount) values ($1, $2, $3, 100)`,
    [fam, olena, andrii]), /row-level security/);
});

test('расчёт отменяет только получатель, пробачення закрывает долг так же, как оплата', async () => {
  const balance = async (member) => Number((await as(ANDRII, 'select balance from member_balances where member_id = $1', [member]))[0].balance);
  const before = await balance(olena);
  await assert.rejects(as(OLENA, `insert into settlements (family_id, from_member_id, to_member_id, amount, kind)
    values ($1, $2, $3, 500, 'forgiven')`, [fam, olena, andrii]), /row-level security/);
  const [{ id }] = await as(ANDRII, `insert into settlements (family_id, from_member_id, to_member_id, amount, kind)
    values ($1, $2, $3, 500, 'forgiven') returning id`, [fam, olena, andrii]);
  assert.equal(await balance(olena), before + 500);

  assert.equal((await as(OLENA, 'delete from settlements where id = $1 returning id', [id])).length, 0);
  assert.equal((await as(ANDRII, 'delete from settlements where id = $1 returning id', [id])).length, 1);
  assert.equal(await balance(olena), before);
});

test('личную операцию видит только автор, даже владелец не видит чужую', async () => {
  const [{ id }] = await as(OLENA, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, comment)
    values ($1, 'expense', -38640, -38640, $2, $2, 'секрет') returning id`, [fam, olena]);

  assert.equal((await as(OLENA, 'select 1 from transactions where id = $1', [id])).length, 1);
  assert.equal((await as(ANDRII, 'select 1 from transactions where id = $1', [id])).length, 0);
  assert.equal((await as(SOFIA, 'select 1 from transactions where id = $1', [id])).length, 0);

  // Владелец не может и изменить или удалить невидимую ему строку.
  assert.equal((await as(ANDRII, `update transactions set comment = 'x' where id = $1 returning id`, [id])).length, 0);
  assert.equal((await as(ANDRII, 'delete from transactions where id = $1 returning id', [id])).length, 0);
  await as(OLENA, 'delete from transactions where id = $1', [id]);
});

const addTx = (user, { type = 'expense', amount = -1000, paidBy, to = null, mode = null, shares = [] }) =>
  as(user, 'select add_transaction($1, $2, $3, now(), null, null, $4, $5, $6, $7) as id',
    [fam, type, amount, paidBy, to, mode, JSON.stringify(shares)]);

test('add_transaction пишет общую операцию с долями и автором-вызывающим', async () => {
  const [{ id }] = await addTx(OLENA, {
    paidBy: andrii, mode: 'shares',
    shares: [{ member_id: andrii, amount: 667, weight: 2 }, { member_id: olena, amount: 333, weight: 1 }],
  });
  const [tx] = await as(ANDRII, 'select created_by_member_id, paid_by_member_id, is_shared, amount_base from transactions where id = $1', [id]);
  assert.equal(tx.created_by_member_id, olena);
  assert.equal(tx.paid_by_member_id, andrii);
  assert.equal(tx.is_shared, true);
  assert.equal(Number(tx.amount_base), -1000);
  assert.equal((await as(SOFIA, 'select 1 from transaction_shares where transaction_id = $1', [id])).length, 2);
  await as(OLENA, 'delete from transactions where id = $1', [id]);
});

test('add_transaction откатывает всё, если доли не сходятся с суммой', async () => {
  const count = async () => (await as(ANDRII, 'select count(*)::int as n from transactions'))[0].n;
  const before = await count();
  await assert.rejects(addTx(ANDRII, {
    paidBy: andrii, mode: 'equal', shares: [{ member_id: andrii, amount: 999, weight: null }],
  }), /does not match/);
  assert.equal(await count(), before);
});

test('add_transaction: личная операция, перевод и ограничения по ролям', async () => {
  const [{ id: personal }] = await addTx(OLENA, { paidBy: olena });
  assert.equal((await as(ANDRII, 'select 1 from transactions where id = $1', [personal])).length, 0);
  await as(OLENA, 'delete from transactions where id = $1', [personal]);

  const [{ id: transfer }] = await addTx(ANDRII, { type: 'transfer', paidBy: andrii, to: olena });
  assert.equal((await as(SOFIA, 'select is_internal_transfer from transactions where id = $1', [transfer]))[0].is_internal_transfer, true);
  await as(ANDRII, 'delete from transactions where id = $1', [transfer]);

  await assert.rejects(addTx(SOFIA, { paidBy: sofia }), /row-level security/);
  await assert.rejects(addTx(STRANGER, { paidBy: andrii }));
  await assert.rejects(addTx(ANDRII, { paidBy: olena }));
});

test('удалить общую операцию могут автор и владелец, доли удаляются с ней', async () => {
  const shares = [{ member_id: andrii, amount: 500, weight: null }, { member_id: olena, amount: 500, weight: null }];
  const [{ id }] = await addTx(ANDRII, { paidBy: andrii, mode: 'equal', shares });
  assert.equal((await as(OLENA, 'delete from transactions where id = $1 returning id', [id])).length, 0);
  assert.equal((await as(SOFIA, 'select 1 from transactions where id = $1', [id])).length, 1);

  const [{ id: hers }] = await addTx(OLENA, { paidBy: olena, mode: 'equal', shares });
  assert.equal((await as(ANDRII, 'delete from transactions where id = $1 returning id', [hers])).length, 1);
  assert.equal((await as(ANDRII, 'select 1 from transaction_shares where transaction_id = $1', [hers])).length, 0);

  await as(ANDRII, 'delete from transactions where id = $1', [id]);
});

const updateTx = (user, id, { amount, paidBy, mode = null, shares = [] }) =>
  as(user, 'select update_transaction($1, $2, $3, now(), null, null, $4, null, $5, $6, null)',
    [id, 'expense', amount, paidBy, mode, JSON.stringify(shares)]);

test('update_transaction меняет сумму и доли, автор остаётся прежним', async () => {
  const half = (n) => [{ member_id: andrii, amount: n, weight: null }, { member_id: olena, amount: n, weight: null }];
  const [{ id }] = await addTx(OLENA, { paidBy: olena, mode: 'equal', shares: half(500) });

  await updateTx(ANDRII, id, { amount: -1500, paidBy: andrii, mode: 'equal', shares: half(750) });
  const [tx] = await as(OLENA, 'select amount_base, created_by_member_id, paid_by_member_id from transactions where id = $1', [id]);
  assert.equal(Number(tx.amount_base), -1500);
  assert.equal(tx.created_by_member_id, olena);
  assert.equal(tx.paid_by_member_id, andrii);
  const shares = await as(OLENA, 'select amount from transaction_shares where transaction_id = $1', [id]);
  assert.deepEqual(shares.map((r) => Number(r.amount)), [750, 750]);

  // Доли не сходятся: откатывается всё, в том числе новая сумма.
  await assert.rejects(updateTx(OLENA, id, { amount: -2000, paidBy: olena, mode: 'equal', shares: half(750) }), /does not match/);
  assert.equal(Number((await as(OLENA, 'select amount_base from transactions where id = $1', [id]))[0].amount_base), -1500);

  // Общую в личную: доли уходят, платит только автор.
  await assert.rejects(updateTx(OLENA, id, { amount: -1500, paidBy: andrii }));
  await updateTx(OLENA, id, { amount: -1500, paidBy: olena });
  assert.equal((await as(OLENA, 'select 1 from transaction_shares where transaction_id = $1', [id])).length, 0);

  await assert.rejects(updateTx(SOFIA, id, { amount: -1500, paidBy: olena }), /transaction not found/);
  await as(OLENA, 'delete from transactions where id = $1', [id]);
});

async function asService(sql, params = []) {
  await db.exec('set role service_role;');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

test('монобанк: токен только в Vault, клиент видит лишь имя подключения', async () => {
  const save = (member, token) => asService('select mono_save_connection($1, $2, $3, $4)', [member, token, 'Андрій К.',
    JSON.stringify([{ external_id: 'acc1', name: 'mono · Чорна 1234', currency: 'UAH' }])]);
  await save(andrii, 'token-1');
  await save(andrii, 'token-2'); // повторное подключение заменяет токен и не дублирует счёт
  assert.equal((await asService('select mono_token($1) as t', [andrii]))[0].t, 'token-2');
  assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n, 1);
  const accounts = await as(ANDRII, `select kind from accounts where external_id = 'acc1'`);
  assert.deepEqual(accounts.map((a) => a.kind), ['mono']);

  assert.equal((await as(ANDRII, 'select client_name from mono_connections'))[0].client_name, 'Андрій К.');
  await assert.rejects(as(ANDRII, 'select secret_id from mono_connections'), /permission denied/);
  await assert.rejects(as(ANDRII, 'select mono_token($1)', [andrii]), /permission denied/);
  await assert.rejects(as(ANDRII, 'select mono_save_connection($1, $2, $3, $4)', [andrii, 'x', 'x', '[]']), /permission denied/);
  assert.equal((await as(OLENA, 'select 1 from mono_connections')).length, 0);
  await assert.rejects(save(sofia, 'token-3'), /member cannot connect mono/);

  await as(ANDRII, 'select disconnect_mono($1)', [fam]);
  assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from mono_connections')).rows[0].n, 0);
  assert.equal((await as(ANDRII, `select 1 from accounts where external_id = 'acc1'`)).length, 1);
  await db.exec(`delete from accounts where external_id = 'acc1'`);
});

test('монобанк: импорт выписки окнами, без дублей и без воскрешения удалённых', async () => {
  await asService('select mono_save_connection($1, $2, $3, $4)', [andrii, 'token', 'Андрій К.',
    JSON.stringify([{ external_id: 'acc-imp', name: 'mono · Чорна 0001', currency: 'UAH' }])]);
  const [{ id: account }] = await db.query(`select id from accounts where external_id = 'acc-imp'`).then((r) => r.rows);
  const claim = () => asService('select * from mono_claim_requests()');
  const unthrottle = () => db.exec(`update mono_connections set last_request_at = now() - interval '2 minutes'`);
  const day = 24 * 3600 * 1000;
  const items = (over = {}) => JSON.stringify([
    { external_id: 'm1', occurred_at: new Date(Date.now() - 5 * day).toISOString(), amount: -12345, hold: true, comment: 'Сільпо', category: 'Продукти', ...over },
    { external_id: 'm2', occurred_at: new Date(Date.now() - 4 * day).toISOString(), amount: 500000, hold: false, comment: 'Зарплата', category: null },
    { external_id: 'm0', occurred_at: new Date(Date.now() - 4 * day).toISOString(), amount: 0, hold: false, comment: 'Перевірка', category: null },
  ]);
  const imp = (window_to, json = items(), next = null) =>
    asService('select mono_import($1, $2, $3, $4)', [account, json, window_to, next]);

  const [job] = await claim();
  assert.equal(job.token, 'token');
  assert.equal(job.external_id, 'acc-imp');
  assert.ok(Date.now() - new Date(job.window_from).getTime() > 27 * day);
  assert.equal((await claim()).length, 0); // минута ещё не прошла

  await imp(job.window_to);
  const rows = await as(ANDRII, `select external_id, type, amount_base, is_hold, is_shared, comment, category_id is not null as has_cat
    from transactions where account_id = $1 order by external_id`, [account]);
  assert.deepEqual(rows.map((r) => [r.external_id, r.type, Number(r.amount_base), r.is_hold, r.has_cat]),
    [['m1', 'expense', -12345, true, true], ['m2', 'income', 500000, false, false]]);
  assert.equal(rows[0].is_shared, false);
  assert.equal((await as(OLENA, 'select 1 from transactions where account_id = $1', [account])).length, 0);
  const [{ cursor }] = await db.query('select mono_cursor as cursor from accounts where id = $1', [account]).then((r) => r.rows);
  assert.ok(Math.abs(Date.now() - 3 * day - new Date(cursor).getTime()) < 60000); // догнали: перечитываем 3 дня

  // Повтор: холд стал окончательным, сумма уточнилась, дублей нет.
  await imp(new Date().toISOString(), items({ hold: false, amount: -12000 }));
  const [m1] = await as(ANDRII, `select id, is_hold, amount_base from transactions where external_id = 'm1'`);
  assert.deepEqual([m1.is_hold, Number(m1.amount_base)], [false, -12000]);
  assert.equal((await as(ANDRII, 'select count(*)::int as n from transactions where account_id = $1', [account]))[0].n, 2);

  // Общую операцию повтор не ломает: сумма и доли остаются.
  await as(ANDRII, `select update_transaction($1, 'expense', -12000, now(), null, null, $2, null, 'equal', $3, $4)`,
    [m1.id, andrii, JSON.stringify([{ member_id: andrii, amount: 6000, weight: null }, { member_id: olena, amount: 6000, weight: null }]), account]);
  await imp(new Date().toISOString(), items({ hold: false, amount: -99999 }));
  assert.equal(Number((await as(OLENA, 'select amount_base from transactions where id = $1', [m1.id]))[0].amount_base), -12000);

  // Удалённая не возвращается.
  await as(ANDRII, `delete from transactions where external_id = 'm2'`);
  await imp(new Date().toISOString());
  assert.equal((await as(ANDRII, `select 1 from transactions where external_id = 'm2'`)).length, 0);

  // 500 операций: окно дочитывается до времени самой старой.
  const pageTo = new Date(Date.now() - 10 * day).toISOString();
  await imp(new Date().toISOString(), '[]', pageTo);
  await unthrottle();
  const [paged] = await claim();
  assert.equal(new Date(paged.window_to).toISOString(), pageTo);

  // Глубина истории: год — счёт перечитывает с нового начала.
  await as(ANDRII, 'select set_mono_history($1, 12)', [fam]);
  await unthrottle();
  const [deep] = await claim();
  assert.ok(Date.now() - new Date(deep.window_from).getTime() > 360 * day);
  await assert.rejects(as(ANDRII, 'select set_mono_history($1, 7)', [fam]), /unsupported/);
  await assert.rejects(as(ANDRII, 'select mono_claim_requests()'), /permission denied/);
  await assert.rejects(as(ANDRII, 'select mono_import($1, $2, now(), null)', [account, '[]']), /permission denied/);

  await as(ANDRII, 'select disconnect_mono($1)', [fam]);
  await db.exec(`delete from transactions where account_id = '${account}'; delete from accounts where id = '${account}'`);
});

test('монобанк: перевод между участниками становится одним внутренним переводом', async () => {
  const connect = (member, ext) => asService('select mono_save_connection($1, $2, $3, $4)', [member, `token-${ext}`, ext,
    JSON.stringify([{ external_id: ext, name: `mono ${ext}`, currency: 'UAH' }])]);
  await connect(andrii, 'acc-a');
  await connect(olena, 'acc-o');
  const accountOf = async (ext) => (await db.query('select id from accounts where external_id = $1', [ext])).rows[0].id;
  const [accA, accO] = [await accountOf('acc-a'), await accountOf('acc-o')];
  const t0 = Date.now() - 2 * 24 * 3600 * 1000;
  const at = (seconds) => new Date(t0 + seconds * 1000).toISOString();
  const imp = (account, list) => asService('select mono_import($1, $2, now(), null)', [account, JSON.stringify(list)]);
  const item = (external_id, seconds, amount) => ({ external_id, occurred_at: at(seconds), amount, hold: false, comment: 'Переказ', category: null });

  // Андрій переводит Олені 500 ₴, её сторона приходит позже, на 20 секунд позже по времени.
  // Тут же: второй расход на ту же сумму (пара берёт ближайший по времени) и сумма, чья встречная пришла через 25 часов.
  // И перевод 30 ₴, чья встречная операция пришла через 20 часов: это всё ещё пара.
  await imp(accA, [item('a1', 0, -50000), item('a2', 600, -50000), item('a3', 30, -7000), item('a4', 100, -3000)]);
  await imp(accO, [item('o1', 20, 50000), item('o2', 25 * 3600, 7000), item('o3', 20 * 3600, 3000)]);

  const rows = await as(SOFIA, `select external_id, type, amount_base, paid_by_member_id, to_member_id, is_internal_transfer
    from transactions where account_id in ($1, $2) order by external_id`, [accA, accO]);
  assert.deepEqual(rows.map((r) => [r.external_id, r.type, r.is_internal_transfer]), [['a1', 'transfer', true], ['a4', 'transfer', true]]);
  assert.equal(rows[0].paid_by_member_id, andrii);
  assert.equal(rows[0].to_member_id, olena);
  assert.equal(Number(rows[0].amount_base), -50000);
  // Остальное — личные операции авторов.
  assert.deepEqual((await as(ANDRII, `select external_id, type from transactions where account_id = $1 and type <> 'transfer' order by external_id`, [accA]))
    .map((r) => [r.external_id, r.type]), [['a2', 'expense'], ['a3', 'expense']]);
  assert.deepEqual((await as(OLENA, `select external_id from transactions where account_id = $1`, [accO])).map((r) => r.external_id), ['o2']);

  // Повторный опрос не возвращает сторону получателя и не ломает перевод.
  await imp(accO, [item('o1', 20, 50000)]);
  await imp(accA, [item('a1', 0, -50000)]);
  assert.equal((await as(OLENA, `select 1 from transactions where external_id = 'o1'`)).length, 0);
  assert.equal((await as(SOFIA, `select type from transactions where external_id = 'a1'`))[0].type, 'transfer');

  // В баланс перевод не входит.
  const balances = await as(ANDRII, 'select balance from member_balances where member_id in ($1, $2)', [andrii, olena]);
  const before = balances.map((b) => Number(b.balance));
  await as(ANDRII, `delete from transactions where external_id = 'a1'`);
  const after = (await as(ANDRII, 'select balance from member_balances where member_id in ($1, $2)', [andrii, olena])).map((b) => Number(b.balance));
  assert.deepEqual(after, before);

  await as(ANDRII, 'select disconnect_mono($1)', [fam]);
  await as(OLENA, 'select disconnect_mono($1)', [fam]);
  await db.exec(`delete from transactions where account_id in ('${accA}', '${accO}'); delete from accounts where id in ('${accA}', '${accO}')`);
});

test('правила спільних делят новые операции с карты владельца правила', async () => {
  await asService('select mono_save_connection($1, $2, $3, $4)', [andrii, 'token-r', 'Андрій',
    JSON.stringify([{ external_id: 'acc-r', name: 'mono r', currency: 'UAH' }])]);
  const account = (await db.query(`select id from accounts where external_id = 'acc-r'`)).rows[0].id;
  const groceries = (await as(ANDRII, `select id from categories where family_id = $1 and name = 'Продукти'`, [fam]))[0].id;
  const imp = (list) => asService('select * from mono_import($1, $2, now(), null)', [account, JSON.stringify(list)]);
  const item = (external_id, amount, extra = {}) => ({
    external_id, occurred_at: new Date().toISOString(), amount, hold: false, comment: 'Магазин', category: null, ...extra,
  });

  // Импортированное до правил не трогаем.
  await imp([item('r0', -1000, { category: 'Продукти' })]);

  await as(ANDRII, 'insert into share_rules (family_id, member_id, category_id) values ($1, $2, $3)', [fam, andrii, groceries]);
  await as(ANDRII, 'insert into share_rules (family_id, member_id, merchant, member_ids) values ($1, $2, $3, $4)',
    [fam, andrii, ' сільпо ', [andrii, olena]]);
  assert.equal((await as(OLENA, 'select 1 from share_rules')).length, 0);
  await assert.rejects(as(SOFIA, 'insert into share_rules (family_id, member_id, merchant) values ($1, $2, $3)', [fam, sofia, 'АТБ']), /row-level security/);
  await assert.rejects(as(OLENA, 'insert into share_rules (family_id, member_id, merchant) values ($1, $2, $3)', [fam, andrii, 'АТБ']), /row-level security/);

  const pushes = await imp([
    item('r1', -1000, { category: 'Продукти' }), // категория: порівну на всю семью (3), лишняя копейка первому
    item('r2', -1001, { comment: 'СІЛЬПО Київ', category: 'Продукти' }), // магазин точнее категории: только Андрій и Олена
    item('r3', -500, { comment: 'Кіно' }), // не подходит
    item('r4', 2000, { comment: 'Сільпо повернення' }), // доход не делим
    item('r5', -700, { category: 'Продукти', hold: true }), // холд ждёт окончательной суммы
  ]);
  const shares = async (ext) => (await as(ANDRII, `select s.member_id, s.amount from transaction_shares s
    join transactions t on t.id = s.transaction_id where t.external_id = $1 order by s.amount desc, s.member_id`, [ext]))
    .map((r) => [r.member_id, Number(r.amount)]);
  const shared = async (ext) => (await as(ANDRII, 'select is_shared from transactions where external_id = $1', [ext]))[0].is_shared;

  // Кого уведомить: все в делении, кроме владельца карты, со своей долей и описанием операции.
  assert.deepEqual(
    pushes.filter((p) => p.kind === 'shared').map((p) => [p.to_member, Number(p.amount), Number(p.total), p.label]).sort(),
    [[olena, 333, 1000, 'Магазин'], [olena, 500, 1001, 'СІЛЬПО Київ'], [sofia, 333, 1000, 'Магазин']].sort(),
  );
  assert.ok(pushes.every((p) => p.from_member === andrii));
  assert.equal(await shared('r0'), false);
  assert.deepEqual((await shares('r1')).map(([, a]) => a), [334, 333, 333]);
  assert.deepEqual(await shares('r2'), [[andrii, 501], [olena, 500]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  assert.equal(await shared('r3'), false);
  assert.equal(await shared('r4'), false);
  assert.equal(await shared('r5'), false);
  assert.equal((await as(OLENA, `select 1 from transactions where external_id = 'r1'`)).length, 1); // общая видна семье

  // История, догруженная после создания правила, правилом не делится.
  await imp([item('r6', -600, { category: 'Продукти', occurred_at: new Date(Date.now() - 30 * 24 * 3600000).toISOString() })]);
  assert.equal(await shared('r6'), false);

  // Холд стал окончательным с другой суммой: делится уже она. Повтор не делит второй раз.
  await imp([item('r5', -900, { category: 'Продукти' })]);
  assert.deepEqual((await shares('r5')).map(([, a]) => a), [300, 300, 300]);
  await imp([item('r5', -900, { category: 'Продукти' })]);
  assert.equal((await shares('r5')).length, 3);

  // Своё правило можно удалить, чужое нельзя.
  assert.equal((await as(OLENA, 'delete from share_rules returning id')).length, 0);
  assert.equal((await as(ANDRII, 'delete from share_rules returning id')).length, 2);

  await as(ANDRII, 'select disconnect_mono($1)', [fam]);
  await db.exec(`delete from transactions where account_id = '${account}'; delete from accounts where id = '${account}'`);
});

test('аналитика: Сім’я — общие траты, Мої — личные, моя доля и переводы отдельно', async () => {
  const cat = async (name) => (await as(ANDRII, 'select id from categories where family_id = $1 and name = $2', [fam, name]))[0].id;
  const [groceries, cafe] = [await cat('Продукти'), await cat('Кафе')];
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString().slice(0, 10);
  // Суммы как словарь «вид:категория → копейки»; в базе есть операции других тестов, поэтому сравниваем приращение.
  const report = async (user, mine) => Object.fromEntries(
    (await as(user, 'select category_id, kind, amount from analytics($1, $2, $3, $4)', [fam, mine, from, to]))
      .map((r) => [`${r.kind}:${r.category_id}`, Number(r.amount)]));
  const cases = [[ANDRII, false], [SOFIA, false], [ANDRII, true], [OLENA, true], [STRANGER, false]];
  // Последовательно: as() переключает пользователя на общем соединении, параллельные вызовы перемешались бы.
  const snapshot = async () => {
    const out = [];
    for (const [u, m] of cases) out.push(await report(u, m));
    return out;
  };
  const before = await snapshot();

  const add = (user, type, amount, category, paidBy, to, mode, shares) =>
    as(user, 'select add_transaction($1, $2, $3, now(), null, $4, $5, $6, $7, $8) as id',
      [fam, type, amount, category, paidBy, to, mode, JSON.stringify(shares)]);
  const half = [{ member_id: andrii, amount: 500, weight: null }, { member_id: olena, amount: 500, weight: null }];
  const ids = [
    await add(ANDRII, 'expense', -1000, groceries, andrii, null, 'equal', half),
    await add(ANDRII, 'expense', -300, cafe, andrii, null, null, []),
    await add(OLENA, 'expense', -700, null, olena, null, null, []),
    await add(ANDRII, 'transfer', -2000, null, andrii, olena, null, []),
    await add(ANDRII, 'income', 9000, null, andrii, null, null, []),
    await add(ANDRII, 'expense', -1000, groceries, andrii, null, 'equal', half), // общий холд: считается сразу
    await add(ANDRII, 'expense', -400, cafe, andrii, null, null, []), // личный холд: ждёт окончательной суммы
  ].map(([r]) => r.id);
  const olenaBalance = async () =>
    Number((await as(OLENA, 'select balance from member_balances where member_id = $1', [olena]))[0].balance);
  const balanceBefore = await olenaBalance();
  await db.exec(`update transactions set is_hold = true where id in ('${ids.at(-2)}', '${ids.at(-1)}')`);
  assert.equal(balanceBefore - (await olenaBalance()), 0, 'общий холд остаётся в балансе');

  const after = await snapshot();
  const delta = after.map((a, i) => Object.fromEntries(
    Object.entries(a).map(([k, v]) => [k, v - (before[i][k] ?? 0)]).filter(([, v]) => v !== 0)));
  assert.deepEqual(delta, [
    { [`expense:${groceries}`]: 2000 },
    { [`expense:${groceries}`]: 2000 },
    { [`expense:${groceries}`]: 1000, [`expense:${cafe}`]: 300, 'transfer:null': 2000 },
    { [`expense:${groceries}`]: 1000, 'expense:null': 700 },
    {},
  ]);

  for (const id of ids) await db.exec(`delete from transactions where id = '${id}'`);
});

test('push-подписки видит только владелец; устройство переходит к новому пользователю', async () => {
  await as(ANDRII, `select claim_push_subscription('https://push/e1', 'p', 'a', 'uk')`);
  assert.equal((await as(ANDRII, 'select 1 from push_subscriptions')).length, 1);
  assert.equal((await as(OLENA, 'select 1 from push_subscriptions')).length, 0);
  await assert.rejects(as(OLENA, `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ('x', $1, 'p', 'a')`, [ANDRII]), /row-level security/);

  await as(OLENA, `select claim_push_subscription('https://push/e1', 'p2', 'a2', 'pl')`);
  assert.equal((await as(ANDRII, 'select 1 from push_subscriptions')).length, 0);
  assert.deepEqual(Object.values((await as(OLENA, 'select p256dh, lang from push_subscriptions'))[0]), ['p2', 'pl']);
  await assert.rejects(as(OLENA, `select claim_push_subscription('https://push/e2', 'p', 'a', 'ru')`), /check/);
  await as(OLENA, `update push_subscriptions set lang = 'en' where endpoint = 'https://push/e1'`);
  assert.equal((await as(OLENA, 'select lang from push_subscriptions'))[0].lang, 'en');
  await as(OLENA, 'delete from push_subscriptions');
});

test('оплата через mono: намерение + выписка закрывают долг, дубль второй стороны убирается', async () => {
  // Олена должна Андрію 500 ₴: общая трата 1000 ₴ пополам, платил Андрій.
  const [{ id: debt }] = await as(ANDRII, `select add_transaction($1, 'expense', -100000, now(), null, null, $2, null, 'equal', $3) as id`,
    [fam, andrii, JSON.stringify([{ member_id: andrii, amount: 50000, weight: null }, { member_id: olena, amount: 50000, weight: null }])]);
  const balance = async (m) => Number((await as(ANDRII, 'select balance from member_balances where member_id = $1', [m]))[0].balance);
  const olenaBefore = await balance(olena);

  // Ссылка: только своя и только send.monobank.ua.
  await as(ANDRII, `select set_pay_link($1, 'https://send.monobank.ua/3KfsToToeE')`, [fam]);
  assert.equal((await as(OLENA, 'select mono_pay_link from family_members where id = $1', [andrii]))[0].mono_pay_link, 'https://send.monobank.ua/3KfsToToeE');
  await assert.rejects(as(ANDRII, `select set_pay_link($1, 'https://evil.example/pay')`, [fam]), /check/);

  // Намерение: платит должник и не больше долга.
  await assert.rejects(as(ANDRII, 'select start_payment($1, $2, 100)', [fam, olena]), /nothing to pay/);
  await assert.rejects(as(OLENA, 'select start_payment($1, $2, $3)', [fam, andrii, -olenaBefore + 1]), /nothing to pay/);
  await as(OLENA, 'select start_payment($1, $2, 50000)', [fam, andrii]);
  assert.equal((await as(SOFIA, 'select 1 from payment_intents')).length, 0);

  // mono есть только у Андрія: его +500 ₴ закрывает долг.
  await asService('select mono_save_connection($1, $2, $3, $4)', [andrii, 't', 'А', JSON.stringify([{ external_id: 'pay-a', name: 'a', currency: 'UAH' }])]);
  const accA = (await db.query(`select id from accounts where external_id = 'pay-a'`)).rows[0].id;
  const at = new Date().toISOString();
  const item = (external_id, amount, time = at) => ({ external_id, occurred_at: time, amount, hold: false, comment: 'Переказ', category: null });
  const closed = await asService('select * from mono_import($1, $2, now(), null)', [accA, JSON.stringify([item('pa1', 50000)])]);
  assert.deepEqual(closed.map((r) => [r.from_member, r.to_member, Number(r.amount)]), [[olena, andrii, 50000]]);
  assert.equal(await balance(olena), olenaBefore + 50000);
  const [tr] = await as(SOFIA, `select type, paid_by_member_id, to_member_id, amount_base from transactions where external_id = 'pa1'`);
  assert.deepEqual([tr.type, tr.paid_by_member_id, tr.to_member_id, Number(tr.amount_base)], ['transfer', olena, andrii, -50000]);

  // Олена подключает mono позже: её −500 ₴ — вторая сторона того же перевода, дубль.
  await asService('select mono_save_connection($1, $2, $3, $4)', [olena, 't', 'О', JSON.stringify([{ external_id: 'pay-o', name: 'o', currency: 'UAH' }])]);
  const accO = (await db.query(`select id from accounts where external_id = 'pay-o'`)).rows[0].id;
  await asService('select * from mono_import($1, $2, now(), null)', [accO, JSON.stringify([item('po1', -50000)])]);
  assert.equal((await as(OLENA, `select 1 from transactions where external_id = 'po1'`)).length, 0);

  // Повторный опрос не ломает перевод, а посторонний доход на ту же сумму остаётся доходом.
  await asService('select * from mono_import($1, $2, now(), null)', [accA, JSON.stringify([item('pa1', 50000), item('pa2', 50000)])]);
  assert.equal(Number((await as(SOFIA, `select amount_base from transactions where external_id = 'pa1'`))[0].amount_base), -50000);
  assert.equal((await as(ANDRII, `select type from transactions where external_id = 'pa2'`))[0].type, 'income');
  assert.equal(await balance(olena), olenaBefore + 50000); // второй раз долг не закрывается

  // Намерение старше суток не срабатывает.
  await db.query(`insert into payment_intents (family_id, from_member_id, to_member_id, amount, created_at)
    values ($1, $2, $3, 1000, now() - interval '30 hours')`, [fam, olena, andrii]);
  const late = await asService('select * from mono_import($1, $2, now(), null)', [accA, JSON.stringify([item('pa3', 1000)])]);
  assert.equal(late.length, 0);

  await as(ANDRII, 'select disconnect_mono($1)', [fam]);
  await as(OLENA, 'select disconnect_mono($1)', [fam]);
  await db.exec(`delete from payment_intents; delete from settlements where from_member_id = '${olena}' and amount = 50000;
    delete from transactions where account_id in ('${accA}', '${accO}') or id = '${debt}';
    delete from accounts where id in ('${accA}', '${accO}'); update family_members set mono_pay_link = null`);
});

test('rename_me меняет только своё имя и не даёт повысить роль', async () => {
  await as(OLENA, `select rename_me($1, ' Оленка ')`, [fam]);
  const rows = await as(ANDRII, 'select id, display_name, role from family_members where family_id = $1', [fam]);
  assert.equal(rows.find((r) => r.id === olena).display_name, 'Оленка');
  assert.equal(rows.find((r) => r.id === olena).role, 'member');
  assert.equal(rows.find((r) => r.id === andrii).display_name, 'Андрій');
  await assert.rejects(as(OLENA, `select rename_me($1, '   ')`, [fam]));
  await assert.rejects(as(STRANGER, `select rename_me($1, 'Гість')`, [fam]), /not a family member/);
  assert.equal((await as(OLENA, `update family_members set role = 'owner' where id = $1 returning id`, [olena])).length, 0);
  await as(OLENA, `select rename_me($1, 'Олена')`, [fam]);
});

test('add_transaction записывает счёт; счёт чужой семьи не проходит', async () => {
  const [{ id: account }] = await as(ANDRII, `insert into accounts (family_id, owner_member_id, name) values ($1, $2, 'Картка') returning id`, [fam, andrii]);
  const [{ id }] = await as(ANDRII, 'select add_transaction($1, $2, $3, now(), null, null, $4, null, null, $5, $6) as id',
    [fam, 'expense', -100, andrii, '[]', account]);
  assert.equal((await as(ANDRII, 'select account_id from transactions where id = $1', [id]))[0].account_id, account);
  await as(ANDRII, 'delete from transactions where id = $1', [id]);
  await as(ANDRII, 'delete from accounts where id = $1', [account]);

  const [{ other }] = await as(STRANGER, `select create_family('Чужа 2', 'Гість') as other`);
  const strangerMember = (await db.query('select id from family_members where family_id = $1', [other])).rows[0].id;
  const [{ id: foreign }] = await as(STRANGER, `insert into accounts (family_id, owner_member_id, name) values ($1, $2, 'Чужий') returning id`, [other, strangerMember]);
  await assert.rejects(as(ANDRII, 'select add_transaction($1, $2, $3, now(), null, null, $4, null, null, $5, $6)',
    [fam, 'expense', -100, andrii, '[]', foreign]));
});

test('счёт нельзя создать на другого участника, а глядач не создаёт и категории', async () => {
  await assert.rejects(as(OLENA, `insert into accounts (family_id, owner_member_id, name) values ($1, $2, 'Чужий')`, [fam, andrii]), /row-level security/);
  await assert.rejects(as(SOFIA, `insert into categories (family_id, name) values ($1, 'Нова')`, [fam]), /row-level security/);
  assert.equal((await as(SOFIA, `update categories set name = 'x' where family_id = $1 returning id`, [fam])).length, 0);
});

test('нельзя записать личную операцию на другого участника', async () => {
  await assert.rejects(as(ANDRII, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -100, -100, $2, $3)`, [fam, andrii, olena]));
});

test('чужой не видит ничего из семьи', async () => {
  for (const table of ['families', 'family_members', 'transactions', 'settlements', 'categories']) {
    const col = table === 'families' ? 'id' : 'family_id';
    assert.equal((await as(STRANGER, `select 1 from ${table} where ${col} = $1`, [fam])).length, 0, table);
  }
  assert.equal((await as(STRANGER, 'select 1 from member_balances where family_id = $1', [fam])).length, 0);
  assert.equal((await as(STRANGER, 'select 1 from transaction_shares where family_id = $1', [fam])).length, 0);
});

test('viewer только читает', async () => {
  assert.ok((await as(SOFIA, 'select 1 from transactions where family_id = $1', [fam])).length > 0);
  await assert.rejects(as(SOFIA, `insert into transactions (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id)
    values ($1, 'expense', -100, -100, $2, $2)`, [fam, sofia]), /row-level security/);
});

test('участник не может повысить себе роль и сменить автора операции', async () => {
  assert.equal((await as(OLENA, `update family_members set role = 'owner' where id = $1 returning id`, [olena])).length, 0);
  await assert.rejects(as(ANDRII, 'update transactions set created_by_member_id = $1', [olena]), /permission denied/);
});

test('возврат уменьшает общую трату: доли, баланс и аналитика по чистой сумме', async () => {
  const exp = '30000000-0000-4000-8000-000000000001';
  const shares = async () => (await as(ANDRII, `select s.member_id, s.amount from transaction_shares s
    join family_members m on m.id = s.member_id where transaction_id = $1 order by m.joined_at`, [exp]))
    .map((r) => [r.member_id, Number(r.amount)]);
  const balance = async (m) => Number((await as(ANDRII, 'select balance from member_balances where member_id = $1', [m]))[0].balance);
  const income = async (user, member, amount) => (await as(user, `insert into transactions
    (family_id, type, amount, amount_base, created_by_member_id, paid_by_member_id, refunded)
    values ($1, 'income', $3, $3, $2, $2, 999) returning id, refunded`, [fam, member, amount]))[0];

  const olenaBefore = await balance(olena);
  await txAs(ANDRII, sharedExpense(exp, {
    paidBy: andrii, total: 154000, shares: [[andrii, 51334], [olena, 51333], [sofia, 51333]],
  }));
  const back = await income(ANDRII, andrii, 77000);
  assert.equal(Number(back.refunded), 0, 'refunded пишет только триггер');

  await as(ANDRII, 'update transactions set refund_of = $1 where id = $2', [exp, back.id]);
  assert.deepEqual(await shares(), [[andrii, 25667], [olena, 25667], [sofia, 25666]]);
  const [{ net }] = await as(OLENA, 'select net_base as net from transactions where id = $1', [exp]);
  assert.equal(Number(net), -77000);
  assert.equal(await balance(olena), olenaBefore - 25667);

  const month = new Date().toISOString().slice(0, 7) + '-01';
  const [{ total }] = await as(OLENA, `select sum(amount)::bigint as total from analytics($1, false, $2::date, ($2::date + interval '1 month')::date)`,
    [fam, month]);
  const [{ shared }] = await as(OLENA, `select -sum(net_base)::bigint as shared from transactions
    where family_id = $1 and is_shared and occurred_at >= $2::date`, [fam, month]);
  assert.equal(Number(total), Number(shared));

  // Возврат на чужую трату и возврат на всю сумму не проходят.
  const hers = await income(OLENA, olena, 1000);
  await assert.rejects(as(OLENA, 'update transactions set refund_of = $1 where id = $2', [exp, hers.id]), /same member/);
  const more = await income(ANDRII, andrii, 77000);
  await assert.rejects(as(ANDRII, 'update transactions set refund_of = $1 where id = $2', [exp, more.id]), /check/);

  await as(ANDRII, 'update transactions set refund_of = null where id = $1', [back.id]);
  assert.deepEqual(await shares(), [[andrii, 51334], [olena, 51333], [sofia, 51333]]);

  await as(ANDRII, 'update transactions set refund_of = $1 where id = $2', [exp, back.id]);
  await as(ANDRII, 'delete from transactions where id = $1', [exp]);
  const [{ refund_of }] = await as(ANDRII, 'select refund_of from transactions where id = $1', [back.id]);
  assert.equal(refund_of, null);
  await as(ANDRII, 'delete from transactions where id = any($1)', [[back.id, more.id]]);
  await as(OLENA, 'delete from transactions where id = $1', [hers.id]);
  assert.equal(await balance(olena), olenaBefore);
});

test('вышедший участник теряет доступ', async () => {
  await as(ANDRII, 'update family_members set left_at = now() where id = $1', [sofia]);
  assert.equal((await as(SOFIA, 'select 1 from transactions where family_id = $1', [fam])).length, 0);
  await as(ANDRII, 'update family_members set left_at = null where id = $1', [sofia]);
});
