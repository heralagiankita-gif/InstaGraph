import { body, handler, methods } from '../../_lib/http';
import { normaliseEmail, startSignUp } from '../../_lib/signup';

/** Asks for the code again. Same ceilings and the same cooldown as the first send. */
export default handler(async (req) => {
  methods(req, 'POST');

  return startSignUp(normaliseEmail(body(req).email));
});
