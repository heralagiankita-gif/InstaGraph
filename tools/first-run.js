/*
  The very first account, on an empty database.

  Worth its own script because it is the one state the ordinary suite never reaches: a graph with a
  single node and no edges at all. Graph code is where that bites — a random walk with nowhere to walk,
  a PageRank over one vertex, a clustering coefficient whose denominator is the number of pairs of
  neighbours you do not have, a community detector asked to partition a set of one. Every one of those
  is a division by zero waiting for its first user.

  So this signs up exactly one account and asks every screen for its data, expecting a well-formed empty
  answer rather than a 500.

  WRITES TO THE DATABASE: it registers one account and there is no delete-account endpoint. Clear up
  afterwards if the database is meant to stay empty.

  Usage: node first-run.js [baseUrl]
*/
const BASE = process.argv[2] || 'http://localhost:5120/api';

const stamp = Date.now().toString(36);
const results = [];

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();

  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }

  return { status: res.status, json, text };
}

async function check(name, path, token, shape) {
  const res = await call('GET', path, { token });
  let ok = res.status >= 200 && res.status < 300;
  let detail = ok ? '' : 'HTTP ' + res.status + ' ' + (res.json?.message ?? res.text.slice(0, 100));

  // Beyond "it did not fall over": the answer has to be a sensibly shaped empty, not null or a string.
  if (ok && shape) {
    const problem = shape(res.json);
    if (problem) { ok = false; detail = problem; }
  }

  results.push({ name, ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  return res.json;
}

const emptyPage = (p) =>
  !p ? 'no body' : !Array.isArray(p.items) ? 'items is not an array' : p.items.length ? null : null;

const isArray = (p) => (Array.isArray(p) ? null : 'expected an array, got ' + typeof p);

async function main() {
  const me = {
    username: 'first' + stamp,
    email: 'first' + stamp + '@first.test',
    password: 'Passw0rd!first',
    fullName: 'First Node',
    dateOfBirth: '1996-05-08',
  };

  console.log('\n== the first account ==');

  // Sign-up is three calls, not one: prove the address, spend the proof, then sign in. The code comes
  // back in the response only because there is no SMTP configured and the API is in Development — which
  // is exactly the shape this script runs against.
  const started = await call('POST', '/auth/signup/start', { body: { email: me.email } });

  if (!started.json?.devCode) {
    console.log('  FAIL send code   HTTP ' + started.status + ' '
      + (started.json?.message ?? 'no devCode — needs a Development build with no SMTP configured'));
    return finish();
  }

  const proof = await call('POST', '/auth/signup/verify', {
    body: { email: me.email, code: started.json.devCode },
  });

  if (!proof.json?.verificationToken) {
    console.log('  FAIL verify code   HTTP ' + proof.status + ' ' + (proof.json?.message ?? ''));
    return finish();
  }

  const reg = await call('POST', '/auth/register', {
    body: { ...me, verificationToken: proof.json.verificationToken },
  });

  if (reg.status !== 200) {
    console.log('  FAIL register   HTTP ' + reg.status + ' ' + (reg.json?.message ?? reg.text.slice(0, 120)));
    return finish();
  }

  // Register hands back a name rather than a session, so the first thing the first account does is
  // prove it knows its own password.
  const signedIn = await call('POST', '/auth/login', {
    body: { login: me.username, password: me.password },
  });

  if (!signedIn.json?.token) {
    console.log('  FAIL log in   HTTP ' + signedIn.status + ' ' + (signedIn.json?.message ?? ''));
    return finish();
  }

  console.log('  ok   register — this account is node 1');
  results.push({ name: 'register', ok: true });

  const T = signedIn.json.token;

  console.log('\n== home, with nothing to show ==');
  await check('feed is an empty page', '/feed?page=1&pageSize=8', T, emptyPage);
  await check('ring row is an empty list', '/feed/highlights', T, isArray);
  await check('story tray is an empty list', '/stories', T, isArray);
  await check('notes is an empty list', '/notes', T, isArray);
  await check('unread count', '/notifications/unread-count', T);
  await check('inbox counts', '/messages/counts', T);

  console.log('\n== the graph, with one node and no edges ==');
  await check('suggestions', '/users/suggestions?limit=8', T, isArray);
  await check('graph suggestions', '/graph/suggestions?limit=8', T, isArray);
  await check('graph stats', '/graph/stats', T, (s) =>
    s && typeof s.following === 'number' ? null : 'stats came back without its counts');
  await check('network view', '/graph/network?depth=2', T, (g) =>
    g && Array.isArray(g.nodes) && Array.isArray(g.edges) ? null : 'network is not a { nodes, edges }');
  await check('graph version', '/graph/version', T);
  await check('own connection path', '/graph/path/' + me.username, T);

  console.log('\n== the other screens ==');
  await check('explore', '/feed/explore?page=1&pageSize=24', T, emptyPage);
  await check('reels', '/feed/reels?page=1&pageSize=6', T, emptyPage);
  await check('trending hashtags', '/hashtags/trending?limit=10', T, isArray);
  await check('search finds nobody', '/users/search?q=zzzz', T);
  await check('own profile', '/users/' + me.username, T);
  await check('own posts', '/users/' + me.username + '/posts', T, emptyPage);
  await check('own tagged tab', '/users/' + me.username + '/tagged', T, emptyPage);
  await check('own followers', '/users/' + me.username + '/followers', T, emptyPage);
  await check('own following', '/users/' + me.username + '/following', T, emptyPage);
  await check('own friends', '/users/' + me.username + '/friends', T, emptyPage);
  await check('saved', '/users/me/saved', T, emptyPage);
  await check('collections', '/users/me/collections', T, isArray);
  await check('archive', '/users/me/archive', T, emptyPage);
  await check('story archive', '/highlights/archive', T, emptyPage);
  await check('own highlights', '/highlights/user/' + me.username, T, isArray);
  await check('inbox', '/messages?folder=inbox', T, emptyPage);
  await check('message candidates', '/messages/candidates?q=', T);
  await check('notifications', '/notifications', T, emptyPage);
  await check('follow requests', '/users/follow-requests', T, isArray);
  await check('settings', '/settings', T);
  await check('activity summary', '/settings/activity', T);
  // These two answer with a bare array rather than a page — deliberately, since neither list is
  // ever long enough to need paging.
  await check('blocked', '/users/me/blocked', T, isArray);
  await check('muted', '/users/me/muted', T, isArray);

  finish(me.username);
}

function finish(username) {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(58));
  console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed');

  if (failed.length) {
    console.log('\nFAILURES:');
    for (const f of failed) console.log('  - ' + f.name);
  }

  if (username) console.log('\nthrowaway account: ' + username);
}

main().catch((e) => { console.error('run threw: ' + e.message); finish(); });
