import { handler, methods } from '../_lib/http';
import { ready } from '../_lib/db';
import { checkUsername } from '../_lib/usernames';

/** Whether a username is free, with free alternatives when it is not. Called while somebody types. */
export default handler(async (req) => {
  methods(req, 'GET');

  const raw = req.query.username;
  const username = Array.isArray(raw) ? raw[0] : raw ?? '';

  await ready();

  return checkUsername(username);
});
