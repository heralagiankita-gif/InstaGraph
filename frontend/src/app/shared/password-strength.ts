/**
 * The password rule, in the browser.
 *
 * <p>
 * It is a mirror of <c>PasswordPolicy</c> on the server, and it exists for one reason: so the meter
 * never says a password is fine that the API then refuses. The server is the one that decides — a rule
 * enforced only in a browser is not enforced at all — but a form that lets somebody type something,
 * submit it, and only then learn it was never going to be accepted is a form that wasted their time.
 * </p>
 *
 * <p>
 * There are now three screens asking for a password — signing up, resetting a forgotten one, and
 * changing one from settings — so the rule lives here rather than in whichever of them was written
 * first. Two copies of a rule is two chances for them to disagree, and the one that disagrees with the
 * server is the one that produces an error nobody can act on.
 * </p>
 */

/** The strings that top every breach list. Kept in step with PasswordPolicy.Common. */
const COMMON = [
  'password',
  '12345678',
  '123456789',
  'qwerty123',
  '111111',
  'iloveyou',
  'instagram',
  'abc12345',
  'password1',
  'letmein1',
  'admin123',
];

export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordStrength {
  /**
   * Nought to four, and read by the meter. One means the password is refused outright, so the bar goes
   * red rather than partly filled — a meter that shows progress on something that will be rejected is
   * telling the wrong story.
   */
  score: 0 | 1 | 2 | 3 | 4;

  /** The one thing still wrong with it, or how good it is once nothing is. */
  label: string;

  /** Whether the server would take it. Everything at score 2 and above. */
  acceptable: boolean;
}

/**
 * Scores a password, optionally against the username it will belong to.
 *
 * <p>
 * The username is optional because two of the three screens do not have one to hand at the moment the
 * password is typed — settings knows it, sign-up is still choosing it, and the reset screen may have
 * been given an email address instead. When it is not known the check is simply skipped here and the
 * server does it, which is the correct way round: the client gets to be helpful, not authoritative.
 * </p>
 */
export function scorePassword(password: string, username = ''): PasswordStrength {
  if (!password) {
    return { score: 0, label: '', acceptable: false };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, acceptable: false };
  }

  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    return { score: 1, label: 'Your password cannot contain your username.', acceptable: false };
  }

  if (COMMON.includes(password.toLowerCase())) {
    return {
      score: 1,
      label: 'That password is too common. Pick something harder to guess.',
      acceptable: false,
    };
  }

  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;

  if (classes < 2) {
    return { score: 1, label: 'Mix letters with numbers or symbols.', acceptable: false };
  }

  if (password.length >= 14 && classes >= 3) {
    return { score: 4, label: 'Strong password.', acceptable: true };
  }

  if (password.length >= 11 || classes >= 3) {
    return { score: 3, label: 'Good password.', acceptable: true };
  }

  return { score: 2, label: 'Okay — longer is better.', acceptable: true };
}
