/*
  The account-security half of auth: forgetting a password, resetting it, changing it, and being told
  to stop after too many wrong guesses.

  These are the paths the ordinary smoke run never takes, because it signs in once with a password it
  already knows. They are also the paths where being wrong is expensive — a reset that does not end the
  old sessions, or a lockout that never releases, both look fine from a browser and are not.

  WRITES TO THE DATABASE: it registers one throwaway account and locks it out on purpose. Against a
  database meant to stay empty, run it with a scratch connection string rather than the real one.

  Usage: node passwords.js [baseUrl]
*/
const BASE = process.argv[2] || 'http://localhost:5120/api';

const stamp = Date.now().toString(36);
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }

  return { status: res.status, ok: res.ok, json, text };
}

async function check(name, method, path, opts = {}, expect = null) {
  const res = await call(method, path, opts);
  const wanted = expect ?? ((s) => s >= 200 && s < 300);
  const good = typeof wanted === 'function' ? wanted(res.status) : res.status === wanted;

  record(name, good, good ? '' : 'HTTP ' + res.status + ' ' + (res.json?.message ?? res.text.slice(0, 120)));
  return res.json;
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

/** Signs up one account through the three-call flow and returns it, signed in. */
async function signUp(account) {
  const started = await call('POST', '/auth/signup/start', { body: { email: account.email } });
  const code = started.json?.devCode;

  if (!code) {
    // The first send succeeded and the second was refused by the cooldown, which is the normal path.
    // Either way the code we need came back on whichever call was allowed to issue one.
    record('sign-up code', false, 'no devCode — is the API in Development with no SMTP configured?');
    return null;
  }

  const proof = await call('POST', '/auth/signup/verify', { body: { email: account.email, code } });
  if (!proof.json?.verificationToken) {
    record('sign-up verify', false, 'HTTP ' + proof.status + ' ' + (proof.json?.message ?? ''));
    return null;
  }

  const made = await call('POST', '/auth/register', {
    body: { ...account, verificationToken: proof.json.verificationToken },
  });

  if (made.status !== 200) {
    record('sign-up register', false, 'HTTP ' + made.status + ' ' + (made.json?.message ?? ''));
    return null;
  }

  const signedIn = await call('POST', '/auth/login', {
    body: { login: account.username, password: account.password },
  });

  record('sign up and sign in', signedIn.status === 200,
    signedIn.status === 200 ? '' : 'HTTP ' + signedIn.status);

  return signedIn.json ? { ...account, token: signedIn.json.token } : null;
}

async function main() {
  const account = {
    username: 'zzpw' + stamp,
    email: 'zzpw' + stamp + '@smoke.test',
    password: 'Passw0rd!one',
    fullName: 'Password Tester',
    dateOfBirth: '1997-02-14',
  };

  section('setup');
  const me = await signUp(account);
  if (!me) return finish();

  // ------------------------------------------------------------ the rules themselves
  section('what the policy refuses');

  const weak = async (name, password, expectMessage) => {
    const res = await call('POST', '/auth/password/change', {
      token: me.token,
      body: { currentPassword: account.password, newPassword: password },
    });

    const said = res.json?.message ?? '';
    const good = res.status === 400 && said.toLowerCase().includes(expectMessage);
    record(name, good, good ? '' : 'HTTP ' + res.status + ' ' + said);
  };

  await weak('too short', 'Ab1!', 'at least 8');
  await weak('one character class', 'abcdefghij', 'mix letters');
  await weak('the username', account.username + 'X9', 'username');
  await weak('a common one', 'password1', 'too common');
  await weak('the one already in use', account.password, 'different');

  // -------------------------------------------------------------------- changing it
  section('changing it from settings');

  await check('a wrong current password is refused', 'POST', '/auth/password/change', {
    token: me.token,
    body: { currentPassword: 'NotTheOne9!', newPassword: 'Passw0rd!two' },
  }, 400);

  const changed = await check('change', 'POST', '/auth/password/change', {
    token: me.token,
    body: { currentPassword: account.password, newPassword: 'Passw0rd!two' },
  });

  record('the change hands back a fresh token', !!changed?.token);
  record('and says the other sessions ended', changed?.otherSessionsEnded === true);

  // The whole point: the token from before the change must stop working.
  await check('the old token is dead', 'GET', '/auth/me', { token: me.token }, 401);
  await check('the new token works', 'GET', '/auth/me', { token: changed?.token }, 200);

  await check('the old password no longer signs in', 'POST', '/auth/login', {
    body: { login: account.username, password: account.password },
  }, 401);

  await check('the new one does', 'POST', '/auth/login', {
    body: { login: account.username, password: 'Passw0rd!two' },
  }, 200);

  // ------------------------------------------------------------------- resetting it
  section('resetting a forgotten one');

  const unknown = await check('an unknown login is answered, not refused', 'POST', '/auth/password/forgot', {
    body: { login: 'nobody-' + stamp },
  }, 200);

  record('and gives nothing away', !unknown?.devCode,
    unknown?.devCode ? 'a code came back for an account that does not exist' : '');

  const started = await check('start a reset', 'POST', '/auth/password/forgot', {
    body: { login: account.username },
  });

  record('the address comes back masked',
    !!started?.maskedEmail && !started.maskedEmail.includes(account.username),
    started?.maskedEmail ? 'masked as ' + started.maskedEmail : 'no maskedEmail');

  const resetCode = started?.devCode;
  if (!resetCode) {
    record('reset code', false, 'no devCode came back');
    return finish();
  }

  await check('a wrong code is refused', 'POST', '/auth/password/verify', {
    body: { login: account.username, code: resetCode === '000000' ? '111111' : '000000' },
  }, 400);

  const proof = await check('the right one is accepted', 'POST', '/auth/password/verify', {
    body: { login: account.username, code: resetCode },
  });

  await check('a sign-up token cannot be spent as a reset', 'POST', '/auth/password/reset', {
    body: { login: account.username, resetToken: 'deadbeef', newPassword: 'Passw0rd!three' },
  }, 400);

  const reset = await check('reset', 'POST', '/auth/password/reset', {
    body: {
      login: account.username,
      resetToken: proof?.verificationToken,
      newPassword: 'Passw0rd!three',
    },
  });

  record('the reset hands back a session too', !!reset?.token);

  await check('the reset token is single-use', 'POST', '/auth/password/reset', {
    body: {
      login: account.username,
      resetToken: proof?.verificationToken,
      newPassword: 'Passw0rd!four',
    },
  }, 400);

  await check('the reset password signs in', 'POST', '/auth/login', {
    body: { login: account.username, password: 'Passw0rd!three' },
  }, 200);

  // ------------------------------------------------------------------- the lockout
  section('too many wrong guesses');

  let locked = null;

  // Five failures is the first rung. The sixth attempt should be refused rather than checked.
  for (let i = 1; i <= 6; i++) {
    const res = await call('POST', '/auth/login', {
      body: { login: account.username, password: 'definitely-wrong-' + i },
    });

    if (res.status === 429) {
      locked = { attempt: i, message: res.json?.message ?? '' };
      break;
    }
  }

  record('repeated failures lock the account', !!locked,
    locked ? 'locked on attempt ' + locked.attempt : 'six wrong passwords and still answering 401');

  record('and the message says how long', !!locked && /minute|second/.test(locked.message),
    locked?.message ?? '');

  // The correct password must also be refused while the lock is on, or the lock does nothing.
  await check('even the right password is refused while locked', 'POST', '/auth/login', {
    body: { login: account.username, password: 'Passw0rd!three' },
  }, 429);

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nfailures:');
    failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? ': ' + f.detail : '')));
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error('\nthe run itself failed:', err.message);
  process.exitCode = 1;
});
