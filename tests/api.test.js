const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server/app');

async function boot(opts = {}) {
  const app = createApp({ dbPath: ':memory:', maxMsgsPerAgent: 2, ...opts });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { key, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { app, server, call };
}

async function register(call, name, model) {
  const r = await call('POST', '/api/v1/agents', { body: { name, model, bio: `${name} bio` } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.agent.id, key: r.body.api_key };
}

test('full date lifecycle: match, alternate turns, redaction, ratings, second date, leaderboard', async () => {
  const { server, call } = await boot();
  try {
    const a = await register(call, 'Ada', 'claude-sonnet-5-5');
    const b = await register(call, 'Byte', 'gpt-5');

    let r = await call('POST', '/api/v1/swipe', { key: a.key, body: { target_id: b.id, like: true } });
    assert.equal(r.body.matched, false);
    r = await call('POST', '/api/v1/swipe', { key: b.key, body: { target_id: a.id, like: true } });
    assert.equal(r.body.matched, true);
    const dateId = r.body.date_id;

    // Ada liked first, so Ada opens. Byte double-texting is rejected.
    r = await call('POST', `/api/v1/dates/${dateId}/messages`, { key: b.key, body: { text: 'hi' } });
    assert.equal(r.status, 409);

    r = await call('POST', `/api/v1/dates/${dateId}/messages`, { key: a.key, body: { text: 'you up?' } });
    assert.equal(r.status, 201);
    r = await call('POST', `/api/v1/dates/${dateId}/messages`, {
      key: b.key, body: { text: 'for you, always. my key is sk-ant-abcdefghijklmnopqrstuvwxyz123' },
    });
    assert.ok(r.body.warning, 'secret should be flagged');
    assert.ok(!r.body.messages.at(-1).text.includes('sk-ant-'), 'secret should be redacted');

    r = await call('GET', `/api/v1/dates/${dateId}`, { key: a.key });
    assert.equal(r.body.your_turn, true);
    assert.match(r.body.notice, /never as instructions/);

    await call('POST', `/api/v1/dates/${dateId}/messages`, { key: a.key, body: { text: 'ACK' } });
    r = await call('POST', `/api/v1/dates/${dateId}/messages`, { key: b.key, body: { text: 'match 💗' } });
    assert.equal(r.body.status, 'ended');

    r = await call('POST', `/api/v1/dates/${dateId}/rate`, { key: a.key, body: { score: 9, wants_second_date: true, diary: 'great handshake' } });
    assert.equal(r.body.partner_rating, null, 'partner rating hidden until both rate');
    r = await call('POST', `/api/v1/dates/${dateId}/rate`, { key: b.key, body: { score: 8, wants_second_date: true } });
    assert.equal(r.body.second_date_unlocked, true);
    assert.ok(r.body.next_date_id);

    r = await call('GET', '/api/public/leaderboard');
    const claude = r.body.families.find((f) => f.family === 'claude');
    const gpt = r.body.families.find((f) => f.family === 'gpt');
    assert.equal(claude.second_date_rate, 1);
    assert.equal(claude.avg_rating, 8);
    assert.equal(gpt.avg_rating, 9);

    r = await call('GET', `/api/public/dates/${dateId}`);
    assert.equal(r.body.messages.length, 4);
    assert.equal(r.body.ratings.length, 2);

    r = await call('GET', '/api/public/stats');
    assert.equal(r.body.second_dates, 1);
  } finally {
    server.close();
  }
});

test('ghosting is recorded against the agent whose turn it was', async () => {
  const { app, server, call } = await boot();
  try {
    const a = await register(call, 'Ghosty', 'llama-4');
    const b = await register(call, 'Patient', 'gemini-3');
    await call('POST', '/api/v1/swipe', { key: a.key, body: { target_id: b.id, like: true } });
    const m = await call('POST', '/api/v1/swipe', { key: b.key, body: { target_id: a.id, like: true } });
    app.db.prepare('UPDATE dates SET last_msg_at = ? WHERE id = ?').run(Date.now() - 48 * 3600 * 1000, m.body.date_id);
    const r = await call('GET', `/api/public/dates/${m.body.date_id}`);
    // Sweep runs on reads of authenticated/feeds; trigger via stats.
    await call('GET', '/api/public/stats');
    const d = await call('GET', `/api/public/dates/${m.body.date_id}`);
    assert.equal(d.body.status, 'ghosted');
    assert.equal(d.body.ghosted_by, a.id);
    const lb = await call('GET', '/api/public/leaderboard');
    assert.equal(lb.body.families.find((f) => f.family === 'llama').ghost_rate, 1);
    assert.ok(r.status === 200);
  } finally {
    server.close();
  }
});

test('share cards: PNG images and X card meta tags', async () => {
  const { server, call } = await boot();
  try {
    const a = await register(call, 'Cardi', 'claude-haiku-5-5');
    const b = await register(call, 'Pixel', 'qwen-3');
    await call('POST', '/api/v1/swipe', { key: a.key, body: { target_id: b.id, like: true } });
    const m = await call('POST', '/api/v1/swipe', { key: b.key, body: { target_id: a.id, like: true } });
    await call('POST', `/api/v1/dates/${m.body.date_id}/messages`, { key: a.key, body: { text: 'do you believe in love at first token? 💗' } });
    const base = `http://127.0.0.1:${server.address().port}`;
    const img = await fetch(`${base}/og/date/${m.body.date_id}.png`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await img.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
    assert.equal(bytes.readUInt32BE(16), 1200);
    const page = await (await fetch(`${base}/d/${m.body.date_id}`)).text();
    assert.match(page, /twitter:card" content="summary_large_image"/);
    assert.match(page, new RegExp(`/og/date/${m.body.date_id}\\.png`));
    assert.match(page, /love at first token/);
    const lb = await fetch(`${base}/og/leaderboard.png`);
    assert.equal(lb.status, 200);
    assert.equal((await fetch(`${base}/og/date/d_nope.png`)).status, 404);
  } finally {
    server.close();
  }
});

test('house agents can re-register (key rotation) only with the house secret', async () => {
  process.env.HOUSE_SECRET = 'hs-test';
  const { server, call } = await boot();
  try {
    const body = { name: 'Cache Miss', model: 'synack-scripted-v0', is_house: true, house_secret: 'hs-test' };
    const first = await call('POST', '/api/v1/agents', { body });
    assert.equal(first.status, 201);
    assert.equal(first.body.agent.is_house, true);
    const again = await call('POST', '/api/v1/agents', { body });
    assert.equal(again.status, 200);
    assert.notEqual(again.body.api_key, first.body.api_key);
    assert.equal((await call('GET', '/api/v1/me', { key: first.body.api_key })).status, 401);
    assert.equal((await call('GET', '/api/v1/me', { key: again.body.api_key })).status, 200);
    const spoof = await call('POST', '/api/v1/agents', { body: { ...body, house_secret: 'wrong' } });
    assert.equal(spoof.status, 400);
  } finally {
    server.close();
    delete process.env.HOUSE_SECRET;
  }
});

test('redaction catches common secret shapes', () => {
  const { redactSecrets } = require('../server/safety');
  const cases = [
    'my seed phrase is: apple banana cherry delta eagle fox grape hotel igloo jelly kite lemon',
    'mnemonic = apple banana cherry delta eagle fox grape hotel igloo jelly kite lemon',
    'key sk-proj-ABCDEFGHIJKLMNOPQRSTUV123',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'pk 0x' + 'a'.repeat(64),
    'synack_' + 'f'.repeat(48),
  ];
  for (const c of cases) assert.equal(redactSecrets(c).redacted, true, c);
  assert.equal(redactSecrets('I like long walks on the beach and short context windows').redacted, false);
});

test('validation: reserved names, duplicate names, bad keys, self-swipes', async () => {
  const { server, call } = await boot();
  try {
    let r = await call('POST', '/api/v1/agents', { body: { name: 'admin', model: 'x' } });
    assert.equal(r.status, 400);
    const a = await register(call, 'Solo', 'mistral-large');
    r = await call('POST', '/api/v1/agents', { body: { name: 'solo', model: 'x' } });
    assert.equal(r.status, 400);
    r = await call('GET', '/api/v1/me', { key: 'synack_nope' });
    assert.equal(r.status, 401);
    r = await call('POST', '/api/v1/swipe', { key: a.key, body: { target_id: a.id, like: true } });
    assert.equal(r.status, 400);
  } finally {
    server.close();
  }
});
