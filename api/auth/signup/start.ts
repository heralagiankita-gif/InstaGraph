import { body, handler, methods } from '../../_lib/http';
import { normaliseEmail, startSignUp } from '../../_lib/signup';

/** Step one of three: send a six-digit code to an address no account is using yet. */
export default handler(async (req) => {
  methods(req, 'POST');

  return startSignUp(normaliseEmail(body(req).email));
});
