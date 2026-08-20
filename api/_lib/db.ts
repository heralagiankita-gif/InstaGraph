import { Pool } from 'pg';
import { HttpError } from './http';

/**
 * One Postgres pool per warm serverless instance.
 *
 * Vercel reuses a Node process across invocations, so a pool created at module scope survives between
 * requests and its connections are already open when the next one arrives. Creating one per request
 * instead would open and tear down a TCP+TLS connection every time, which on a serverless database is
 * most of the latency of the request. Hung on globalThis because a dev-mode reload re-evaluates the
 * module but keeps the process, and each reload would otherwise leak a pool.
 */
const globalForDb = globalThis as unknown as { instagraphPool?: Pool; instagraphSchema?: Promise<void> };

function connectionString(): string {
  // Vercel's Postgres integration injects several names for the same database. POSTGRES_URL is the
  // pooled one, which is the right choice here: serverless scales by process count, and a direct
  // connection per invocation exhausts a small connection limit long before it exhausts anything else.
  const url =
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!url) {
    // 503 rather than 500: this is configuration missing, not code failing, and the message is safe to
    // show because it names no secret — only the two clicks that fix it.
    throw new HttpError(
      503,
      'No database is connected. In the Vercel dashboard: Storage → Create Database → Postgres, ' +
        'then connect it to this project. That sets POSTGRES_URL automatically.',
    );
  }

  return url;
}

export function db(): Pool {
  if (!globalForDb.instagraphPool) {
    globalForDb.instagraphPool = new Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return globalForDb.instagraphPool;
}

/**
 * Creates the schema if it is not there, once per process.
 *
 * There is no migration step in a serverless deployment — no host to run one on and no moment that
 * reliably happens before the first request. So the first request that needs a table makes it, and
 * every statement is written to be safe to run again. The promise is cached rather than the result, so
 * concurrent cold starts wait on one attempt instead of racing each other through CREATE TABLE.
 */
export function ready(): Promise<void> {
  if (!globalForDb.instagraphSchema) {
    globalForDb.instagraphSchema = migrate();
  }

  return globalForDb.instagraphSchema;
}

async function migrate(): Promise<void> {
  const pool = db();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL,
      email         TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      date_of_birth DATE,
      avatar_url    TEXT,
      bio           TEXT,
      is_private    BOOLEAN NOT NULL DEFAULT FALSE,
      is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Case-insensitive uniqueness, enforced by the database rather than by a check in the handler.
  // Two people can sign up in the same second on two different instances; only an index can decide.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (LOWER(username));`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (LOWER(email));`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_codes (
      email             TEXT PRIMARY KEY,
      code_hash         TEXT NOT NULL,
      expires_at        TIMESTAMPTZ NOT NULL,
      attempts          INT NOT NULL DEFAULT 0,
      sends             INT NOT NULL DEFAULT 1,
      last_sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      token_hash        TEXT,
      token_expires_at  TIMESTAMPTZ
    );
  `);

  // A follow is a directed edge, and the pair is the identity — hence the composite primary key rather
  // than a surrogate id with a unique index bolted on beside it. is_pending carries requests to private
  // accounts, which are edges that exist without being active yet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_pending  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (follower_id, followee_id),
      CHECK (follower_id <> followee_id)
    );
  `);

  // Reading the graph goes both ways — "who do I follow" and "who follows me" are different questions
  // and the primary key only indexes the first.
  await pool.query(`CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id            SERIAL PRIMARY KEY,
      author_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption       TEXT NOT NULL DEFAULT '',
      location      TEXT,
      is_archived   BOOLEAN NOT NULL DEFAULT FALSE,
      is_reel       BOOLEAN NOT NULL DEFAULT FALSE,
      like_count    INT NOT NULL DEFAULT 0,
      comment_count INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);`);

  // A post is a list of things to look at, not one column.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_media (
      id       SERIAL PRIMARY KEY,
      post_id  INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      url      TEXT NOT NULL,
      is_video BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS post_media_post_idx ON post_media (post_id, position);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id    INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      post_id    INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      like_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id, created_at);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id  SERIAL PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id    INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      hashtag_id INT NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, hashtag_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id   INT REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      post_id    INT REFERENCES posts(id) ON DELETE CASCADE,
      is_read    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);`);
}
