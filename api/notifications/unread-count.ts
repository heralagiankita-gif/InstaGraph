import { requireUser } from '../_lib/auth';
import { db, ready } from '../_lib/db';
import { handler, methods } from '../_lib/http';

/** Drives the red dot on the sidebar. */
export default handler(async (req, res) => {
  methods(req, 'GET');

  const me = await requireUser(req);

  await ready();

  const { rows } = await db().query<{ count: string }>(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND NOT is_read`, [me.id]);

  // A bare number, not an object — this endpoint returns ActionResult<int> in the .NET API and the
  // client reads the body as a number.
  res.status(200).json(Number(rows[0].count));
});
