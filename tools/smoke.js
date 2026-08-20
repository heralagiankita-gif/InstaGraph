/*
  WRITES TO THE DATABASE. It registers two accounts and posts as them, and there is no delete-account
  endpoint to undo that — so against a database that is meant to stay empty, clear it afterwards with
  the wipe described in the README rather than leaving the accounts behind.

  Walks every screen's API surface with two throwaway accounts.

  The point is to find what is actually broken rather than guess at it. Every request a page makes on
  load is made here in the same order, so a 500 shows up against the screen that would have hit it.

  Usage: node smoke.js [baseUrl]
*/
const BASE = process.argv[2] || 'http://localhost:5120/api';
const zlib = require('zlib');

const stamp = Date.now().toString(36);
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
}

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }

  return { status: res.status, ok: res.ok, json, text };
}

/** Checks a call and records it. Returns the payload so it can be chained. */
async function check(name, method, path, opts = {}, expect = null) {
  const res = await call(method, path, opts);
  const wanted = expect ?? ((s) => s >= 200 && s < 300);
  const good = typeof wanted === 'function' ? wanted(res.status) : res.status === wanted;

  record(name, good, good ? '' : 'HTTP ' + res.status + ' ' + (res.json?.message ?? res.text.slice(0, 120)));
  return res.json;
}

// ------------------------------------------------------------------ tiny files

/*
  A file that is genuinely an MP4 as far as anything reading its header is concerned: the ftyp box an
  ISO base-media file has to open with, then some filler.

  This used to be the string "not-really-a-video-but-the-api-only-checks-the-extension", which was true
  when it was written and is not any more — ImageStorage now checks the leading bytes against the
  extension, because an extension is a claim the client makes and the thing it decides is how the file
  gets served back. So the fixture has to be the shape it says it is.
*/
/*
  A JFIF header, for the poster frame.

  It used to be a PNG called poster-0.jpg, which passed while the API took the extension's word for it.
  It is worth getting right rather than working around: the browser really does send a JPEG here —
  create/media.ts grabs the first frame with canvas.toBlob(..., 'image/jpeg') — so a fixture that sends
  PNG bytes under a .jpg name was testing something the app never does.
*/
function tinyJpeg() {
  const header = Buffer.from([
    0xff, 0xd8,                         // SOI
    0xff, 0xe0, 0x00, 0x10,             // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00,       // 'JFIF\0'
    0x01, 0x01, 0x00,                   // version, units
    0x00, 0x01, 0x00, 0x01,             // density
    0x00, 0x00,                         // no thumbnail
  ]);

  return Buffer.concat([header, Buffer.alloc(256), Buffer.from([0xff, 0xd9])]);
}

function tinyMp4() {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18,             // box length: 24
    0x66, 0x74, 0x79, 0x70,             // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d,             // major brand 'isom'
    0x00, 0x00, 0x02, 0x00,             // minor version
    0x69, 0x73, 0x6f, 0x6d,             // compatible: 'isom'
    0x69, 0x73, 0x6f, 0x32,             // compatible: 'iso2'
  ]);

  // Enough filler that the upload is a file rather than a header. Nothing decodes it.
  return Buffer.concat([ftyp, Buffer.alloc(512)]);
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A real, valid PNG of a solid colour. */
function png(size, rgb) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = 255;
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const blob = (buf, type) => new Blob([buf], { type });

/**
 * Signing up is three calls now, so the smoke test walks them the way the app does: ask for a code,
 * read it back out of the response (Development only, and only because no SMTP is configured), spend it
 * on register, then log in for the token every later call needs.
 *
 * Register no longer returns a session — see RegisteredResponse — so the token comes from the login.
 */
async function signUp(label, account) {
  const sent = await check(label + ': send code', 'POST', '/auth/signup/start', { body: { email: account.email } });
  if (!sent?.devCode) return null;

  const proof = await check(label + ': verify code', 'POST', '/auth/signup/verify', {
    body: { email: account.email, code: sent.devCode },
  });
  if (!proof?.verificationToken) return null;

  const made = await check(label + ': register', 'POST', '/auth/register', {
    body: { ...account, verificationToken: proof.verificationToken },
  });
  if (!made?.username) return null;

  const session = await check(label + ': log in', 'POST', '/auth/login', {
    body: { login: account.username, password: account.password },
  });

  return session?.token ?? null;
}

async function main() {
  console.log('\n== auth ==');

  const alice = { username: 'zz' + stamp + 'a', email: 'zz' + stamp + 'a@smoke.test', password: 'passw0rd', fullName: 'Smoke Alice', dateOfBirth: '1998-04-12' };
  const bob = { username: 'zz' + stamp + 'b', email: 'zz' + stamp + 'b@smoke.test', password: 'passw0rd', fullName: 'Smoke Bob', dateOfBirth: '1996-11-03' };

  const A = await signUp('A', alice);
  const B = await signUp('B', bob);

  if (!A || !B) {
    console.log('\nregistration failed — nothing else can run.');
    return finish();
  }

  await check('username availability', 'GET', '/auth/username-available?username=' + alice.username);
  await check('resend code is rate limited', 'POST', '/auth/signup/resend', { body: { email: alice.email } }, 409);
  await check('me', 'GET', '/auth/me', { token: A });

  console.log('\n== home ==');
  await check('feed', 'GET', '/feed?page=1&pageSize=8', { token: A });
  await check('feed highlights (ring row)', 'GET', '/feed/highlights', { token: A });
  await check('story tray', 'GET', '/stories', { token: A });
  await check('suggestions', 'GET', '/users/suggestions?limit=5', { token: A });
  await check('notes', 'GET', '/notes', { token: A });
  await check('unread count', 'GET', '/notifications/unread-count', { token: A });
  await check('inbox counts', 'GET', '/messages/counts', { token: A });

  console.log('\n== explore / discover / network / tags ==');
  await check('explore', 'GET', '/feed/explore?page=1&pageSize=24', { token: A });
  await check('trending hashtags', 'GET', '/hashtags/trending?limit=10', { token: A });
  await check('graph suggestions', 'GET', '/graph/suggestions?limit=8', { token: A });
  await check('graph stats', 'GET', '/graph/stats', { token: A });
  await check('graph network', 'GET', '/graph/network?depth=2', { token: A });
  await check('search', 'GET', '/users/search?q=zz', { token: A });

  console.log('\n== reels ==');
  await check('reels feed', 'GET', '/feed/reels?page=1&pageSize=6', { token: A });

  console.log('\n== follow graph ==');
  await check('A follows B', 'POST', '/users/' + bob.username + '/follow', { token: A });
  await check('profile B (as A)', 'GET', '/users/' + bob.username, { token: A });
  await check('B followers', 'GET', '/users/' + bob.username + '/followers', { token: A });
  await check('A following', 'GET', '/users/' + alice.username + '/following', { token: A });
  await check('connection path', 'GET', '/graph/path/' + bob.username, { token: A });
  await check('mutuals', 'GET', '/graph/mutuals/' + bob.username, { token: A });

  console.log('\n== create a post (carousel of two) ==');
  const form = new FormData();
  form.append('media', blob(png(24, [230, 60, 120]), 'image/png'), 'one.png');
  form.append('media', blob(png(24, [60, 120, 230]), 'image/png'), 'two.png');
  form.append('aspectRatios', '1'); form.append('aspectRatios', '1');
  form.append('durations', '0'); form.append('durations', '0');
  form.append('caption', 'smoke #test @' + bob.username);
  form.append('location', 'Testville');

  const post = await check('create carousel post', 'POST', '/posts', { token: B, form });

  console.log('\n== what the uploader refuses ==');

  // The extension is a claim the client makes, and it is the claim that decides how the file gets
  // served back later. These two are the cases where believing it costs something.
  const liar = new FormData();
  liar.append('media', blob(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), 'evil.png');
  liar.append('aspectRatios', '1');
  liar.append('durations', '0');

  await check('a document renamed .png is refused', 'POST', '/posts', { token: B, form: liar }, 400);

  const svg = new FormData();
  svg.append('media', blob(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'image/svg+xml'), 'x.svg');
  svg.append('aspectRatios', '1');
  svg.append('durations', '0');

  await check('an SVG is not an accepted type at all', 'POST', '/posts', { token: B, form: svg }, 400);

  console.log('\n== create a reel (single video) ==');
  const vform = new FormData();
  vform.append('media', blob(tinyMp4(), 'video/mp4'), 'clip.mp4');
  vform.append('aspectRatios', '0.5625');
  vform.append('durations', '4200');
  vform.append('posters', blob(tinyJpeg(), 'image/jpeg'), 'poster-0.jpg');
  vform.append('posterFor', '0');
  vform.append('caption', 'a reel');

  const reel = await check('create video post', 'POST', '/posts', { token: B, form: vform });
  if (reel) record('video post flagged isReel', reel.isReel === true, 'isReel=' + reel.isReel);
  if (reel) record('video cover is the poster', /\.jpe?g$/i.test(reel.imageUrl || ''), reel.imageUrl);

  if (post) {
    record('carousel has 2 media', (post.media || []).length === 2, 'media=' + (post.media || []).length);
    record('carousel not a reel', post.isReel === false, 'isReel=' + post.isReel);
  }

  const id = post?.id;

  if (id) {
    console.log('\n== post page ==');
    await check('get post', 'GET', '/posts/' + id, { token: A });
    await check('like', 'POST', '/posts/' + id + '/like', { token: A });
    await check('likes list', 'GET', '/posts/' + id + '/likes', { token: A });
    const comment = await check('comment', 'POST', '/posts/' + id + '/comments', { token: A, body: { text: 'nice @' + bob.username, parentId: null } });
    await check('comments', 'GET', '/posts/' + id + '/comments', { token: A });
    if (comment) await check('like comment', 'POST', '/posts/comments/' + comment.id + '/like', { token: A });
    if (comment) await check('reply', 'POST', '/posts/' + id + '/comments', { token: B, body: { text: 'ta', parentId: comment.id } });
    await check('save', 'POST', '/posts/' + id + '/save', { token: A });
    await check('view', 'POST', '/posts/' + id + '/view', { token: A });
    await check('edit post', 'PUT', '/posts/' + id, { token: B, body: { caption: 'edited', location: null, commentsDisabled: false, hideCounts: false } });

    console.log('\n== tagging ==');
    // Register no longer hands back the account, so the id comes from /auth/me instead.
    const aId = (await check('who A is', 'GET', '/auth/me', { token: A }))?.id;
    await check('set tags', 'PUT', '/posts/' + id + '/tags', { token: B, body: { tags: [{ userId: aId, mediaPosition: 0, x: 0.4, y: 0.6 }] } });
    await check('tagged tab', 'GET', '/users/' + alice.username + '/tagged', { token: A });

    console.log('\n== collections ==');
    const col = await check('create collection', 'POST', '/users/me/collections', { token: A, body: { name: 'Smoke ' + stamp } });
    await check('list collections', 'GET', '/users/me/collections', { token: A });
    if (col) await check('file post into collection', 'PUT', '/posts/' + id + '/collection', { token: A, body: { collectionId: col.id } });
    if (col) await check('saved in collection', 'GET', '/users/me/saved?collectionId=' + col.id, { token: A });
    await check('saved (all)', 'GET', '/users/me/saved', { token: A });

    console.log('\n== pin and archive ==');
    await check('pin', 'POST', '/posts/' + id + '/pin', { token: B });
    await check('unpin', 'DELETE', '/posts/' + id + '/pin', { token: B });
    await check('archive', 'POST', '/posts/' + id + '/archive', { token: B });
    await check('archive list', 'GET', '/users/me/archive', { token: B });
    await check('unarchive', 'DELETE', '/posts/' + id + '/archive', { token: B });
  }

  console.log('\n== stories and highlights ==');
  const sform = new FormData();
  sform.append('image', blob(png(24, [90, 200, 130]), 'image/png'), 's.png');
  sform.append('caption', 'a story');
  sform.append('closeFriendsOnly', 'false');
  const story = await check('post story', 'POST', '/stories', { token: B, form: sform });

  await check('story tray (A sees B)', 'GET', '/stories', { token: A });
  await check('stories by user', 'GET', '/stories/' + bob.username, { token: A });
  if (story) await check('mark story seen', 'POST', '/stories/' + story.id + '/view', { token: A });
  if (story) await check('story viewers', 'GET', '/stories/' + story.id + '/viewers', { token: B });
  await check('story archive', 'GET', '/highlights/archive', { token: B });

  let highlight = null;
  if (story) {
    highlight = await check('create highlight', 'POST', '/highlights', { token: B, body: { title: 'Smoke', storyIds: [story.id] } });
    await check('highlights on profile', 'GET', '/highlights/user/' + bob.username, { token: A });
    if (highlight) await check('open highlight', 'GET', '/highlights/' + highlight.id, { token: A });
    if (highlight) await check('rename highlight', 'PUT', '/highlights/' + highlight.id, { token: B, body: { title: 'Smoke 2' } });
  }

  console.log('\n== messages ==');
  const convo = await check('open thread', 'POST', '/messages', { token: A, body: { usernames: [bob.username] } });
  if (convo) {
    await check('send message', 'POST', '/messages/' + convo.id + '/messages', { token: A, body: { text: 'hello' } });
    await check('read thread', 'GET', '/messages/' + convo.id, { token: A });
    await check('inbox', 'GET', '/messages?folder=inbox', { token: A });
    await check('mark read', 'POST', '/messages/' + convo.id + '/read', { token: B });
  }
  await check('chat candidates', 'GET', '/messages/candidates?q=zz', { token: A });

  console.log('\n== activity and settings ==');
  await check('notifications', 'GET', '/notifications', { token: B });
  await check('follow requests', 'GET', '/users/follow-requests', { token: B });
  await check('settings', 'GET', '/settings', { token: A });
  await check('activity summary', 'GET', '/settings/activity', { token: A });
  await check('close friends list', 'GET', '/settings/lists/close-friends', { token: A });
  await check('favorites list', 'GET', '/settings/lists/favorites', { token: A });
  await check('blocked', 'GET', '/users/me/blocked', { token: A });
  await check('muted', 'GET', '/users/me/muted', { token: A });

  console.log('\n== profile ==');
  await check('own profile', 'GET', '/users/' + alice.username, { token: A });
  await check('user posts', 'GET', '/users/' + bob.username + '/posts', { token: A });
  await check('friends list', 'GET', '/users/' + bob.username + '/friends', { token: A });

  // ---------------------------------------------------------------------------
  // Everything the first pass leaves alone: the writes that undo things, the ones
  // that need a third account, and the corners of messaging and settings.
  //
  // Ordered so that the relationship-breaking calls come last — blocking or
  // unfollowing halfway through would make the checks after it fail for reasons
  // that have nothing to do with the endpoint being tested.
  // ---------------------------------------------------------------------------
  console.log('\n== notes ==');
  await check('write note', 'POST', '/notes', { token: A, body: { text: 'testing', closeFriendsOnly: false } });
  await check('read notes', 'GET', '/notes', { token: B });
  await check('clear note', 'DELETE', '/notes', { token: A });

  console.log('\n== hashtags and graph ==');
  await check('hashtag page', 'GET', '/hashtags/test/posts', { token: A });
  await check('graph version', 'GET', '/graph/version', { token: A });

  console.log('\n== settings ==');
  await check('update settings', 'PUT', '/settings', {
    token: A,
    body: {
      isPrivate: false,
      messagesFrom: 'Everyone',
      commentsFrom: 'Everyone',
      showActivityStatus: true,
      showReadReceipts: true,
      hideLikeCounts: false,
      hiddenWords: '',
    },
  });
  await check('add close friend', 'POST', '/settings/lists/close-friends/' + alice.username, { token: B });
  await check('remove close friend', 'DELETE', '/settings/lists/close-friends/' + alice.username, { token: B });
  await check('add favourite', 'POST', '/settings/lists/favorites/' + bob.username, { token: A });
  await check('remove favourite', 'DELETE', '/settings/lists/favorites/' + bob.username, { token: A });

  console.log('\n== profile edits ==');
  await check('update profile', 'PUT', '/users/me', {
    token: A,
    body: { fullName: 'Smoke Alice', bio: 'testing', isPrivate: false },
  });

  const avatar = new FormData();
  avatar.append('file', blob(png(32, [120, 90, 220]), 'image/png'), 'avatar.png');
  await check('upload avatar', 'POST', '/users/me/avatar', { token: A, form: avatar });

  console.log('\n== messaging, the rest ==');
  if (convo) {
    const photo = new FormData();
    photo.append('image', blob(png(20, [200, 160, 40]), 'image/png'), 'chat.png');
    await check('send photo', 'POST', '/messages/' + convo.id + '/photo', { token: A, form: photo });

    await check('typing', 'POST', '/messages/' + convo.id + '/typing', { token: A });
    await check('mute/pin thread', 'PUT', '/messages/' + convo.id, { token: A, body: { isMuted: true, isPinned: true } });

    if (id) {
      await check('share a post into chat', 'POST', '/messages/share', {
        token: A,
        body: { postId: id, usernames: [bob.username], text: 'look' },
      });
    }

    const sent = await call('POST', '/messages/' + convo.id + '/messages', { token: A, body: { text: 'react to me' } });
    const messageId = sent.json?.id;

    if (messageId) {
      await check('react to message', 'POST', '/messages/messages/' + messageId + '/react', { token: B, body: { emoji: '\u2764\ufe0f' } });
      await check('unsend message', 'DELETE', '/messages/messages/' + messageId, { token: A });
    }
  }

  // A thread from a stranger is what the accept / decline / leave endpoints are for.
  const carol = { username: 'zz' + stamp + 'c', email: 'zz' + stamp + 'c@smoke.test', password: 'passw0rd', fullName: 'Smoke Carol', dateOfBirth: '1999-07-21' };
  const C = await signUp('C', carol);

  if (C) {
    const request = await check('C opens a thread with A', 'POST', '/messages', { token: C, body: { usernames: [alice.username] } });

    if (request) {
      await check('requests folder', 'GET', '/messages?folder=requests', { token: A });
      await check('accept request', 'POST', '/messages/' + request.id + '/accept', { token: A });
    }

    const group = await check('create a group', 'POST', '/messages', { token: A, body: { usernames: [bob.username, carol.username], title: 'Smoke group' } });
    if (group) {
      await check('leave group', 'POST', '/messages/' + group.id + '/leave', { token: C });
      await check('delete thread', 'DELETE', '/messages/' + group.id, { token: A });
    }

    const spam = await check('C opens another thread', 'POST', '/messages', { token: C, body: { usernames: [bob.username] } });
    if (spam) await check('decline as spam', 'POST', '/messages/' + spam.id + '/decline?spam=true', { token: B });
  }

  console.log('\n== follow requests (private account) ==');
  await check('B goes private', 'PUT', '/settings', {
    token: B,
    body: { isPrivate: true, messagesFrom: 'Everyone', commentsFrom: 'Everyone', showActivityStatus: true, showReadReceipts: true, hideLikeCounts: false, hiddenWords: '' },
  });

  if (C) {
    await check('C requests to follow B', 'POST', '/users/' + bob.username + '/follow', { token: C });
    await check('B sees the request', 'GET', '/users/follow-requests', { token: B });
    await check('B accepts', 'POST', '/users/follow-requests/' + carol.username + '/accept', { token: B });
    await check('C requests again after removal', 'DELETE', '/users/' + bob.username + '/follow', { token: C });
    await check('C requests once more', 'POST', '/users/' + bob.username + '/follow', { token: C });
    await check('B rejects', 'POST', '/users/follow-requests/' + carol.username + '/reject', { token: B });
  }

  await check('B goes public again', 'PUT', '/settings', {
    token: B,
    body: { isPrivate: false, messagesFrom: 'Everyone', commentsFrom: 'Everyone', showActivityStatus: true, showReadReceipts: true, hideLikeCounts: false, hiddenWords: '' },
  });

  console.log('\n== story reply and delete ==');
  if (story) {
    await check('reply to story', 'POST', '/stories/' + story.id + '/reply', { token: A, body: { text: 'nice one' } });
    await check('delete story', 'DELETE', '/stories/' + story.id, { token: B });
  }
  if (highlight) await check('delete highlight', 'DELETE', '/highlights/' + highlight.id, { token: B });

  console.log('\n== undo the post interactions ==');
  if (id) {
    await check('unsave', 'DELETE', '/posts/' + id + '/save', { token: A });
    await check('unlike', 'DELETE', '/posts/' + id + '/like', { token: A });

    const c2 = await call('POST', '/posts/' + id + '/comments', { token: A, body: { text: 'delete me', parentId: null } });
    if (c2.json?.id) {
      await check('unlike comment', 'DELETE', '/posts/comments/' + c2.json.id + '/like', { token: A });
      await check('delete comment', 'DELETE', '/posts/comments/' + c2.json.id, { token: A });
    }
  }

  console.log('\n== collections cleanup ==');
  const cols = await call('GET', '/users/me/collections', { token: A });
  const first = cols.json?.[0];
  if (first) {
    await check('rename collection', 'PUT', '/users/me/collections/' + first.id, { token: A, body: { name: 'Renamed ' + stamp } });
    await check('delete collection', 'DELETE', '/users/me/collections/' + first.id, { token: A });
  }

  await check('mark notifications read', 'POST', '/notifications/read-all', { token: B });

  console.log('\n== relationships, last because they break visibility ==');
  await check('mute B', 'POST', '/users/' + bob.username + '/mute', { token: A });
  await check('unmute B', 'DELETE', '/users/' + bob.username + '/mute', { token: A });
  await check('block B', 'POST', '/users/' + bob.username + '/block', { token: A });
  await check('unblock B', 'DELETE', '/users/' + bob.username + '/block', { token: A });
  await check('A follows B again', 'POST', '/users/' + bob.username + '/follow', { token: A });
  await check('B removes A as a follower', 'DELETE', '/users/' + alice.username + '/follower', { token: B });
  await check('A follows B once more', 'POST', '/users/' + bob.username + '/follow', { token: A });
  await check('A unfollows B', 'DELETE', '/users/' + bob.username + '/follow', { token: A });

  if (id) await check('delete the post', 'DELETE', '/posts/' + id, { token: B });

  finish({ alice: alice.username, bob: bob.username });
}

function finish(accounts) {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed');

  if (failed.length) {
    console.log('\nFAILURES:');
    for (const f of failed) console.log('  - ' + f.name + '   ' + f.detail);
  }

  if (accounts) console.log('\nthrowaway accounts: ' + accounts.alice + ', ' + accounts.bob);
}

main().catch((e) => { console.error('smoke run threw: ' + e.message); finish(); });
