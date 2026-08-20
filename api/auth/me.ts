import { requireUser, summary } from '../_lib/auth';
import { handler, methods } from '../_lib/http';

/** The account behind the current token. The client calls this on boot to restore a session. */
export default handler(async (req) => {
  methods(req, 'GET');

  return summary(await requireUser(req));
});
