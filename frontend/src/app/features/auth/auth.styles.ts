/**
 * Shared between the two signed-out screens so they cannot drift apart.
 *
 * The layout is Instagram's: one centred row that is a showcase beside a narrow column of boxes on a
 * wide screen, and just the column on a phone. The boxes are not: the real signed-out page is a form
 * ruled off in hairlines, and these are frosted cards floating over the aura, which is most of what
 * makes the first screen of the app feel like the rest of it.
 */
export const authStyles = `
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 32px 16px 0;
  }

  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    width: 100%;
    max-width: 820px;
  }

  /* The phone is the first thing to go: below 876px the real page drops it too. */
  .showcase {
    display: none;
    flex: none;
  }

  @media (min-width: 876px) {
    .showcase {
      display: block;
    }
  }

  .wrap {
    width: 100%;
    max-width: 350px;
    flex: none;
  }

  /* Frosted and properly rounded, floating over the aura rather than ruled off from it. The real
     signed-out page is a form in a box; this one is a card, which is the whole difference in feel. */
  .panel {
    background: color-mix(in srgb, var(--surface) 74%, transparent);
    backdrop-filter: blur(26px) saturate(180%);
    -webkit-backdrop-filter: blur(26px) saturate(180%);
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: var(--radius-xl);
    padding: 40px 34px 26px;
    text-align: center;
    box-shadow: var(--shadow-lg);
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .panel {
      background: var(--surface);
    }
  }

  .panel .wordmark {
    font-size: 52px;
    display: block;
    margin: 0 0 4px;
  }

  .panel .kicker {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-3);
    margin: 0 0 22px;
  }

  .tagline {
    color: var(--ink-3);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    margin: 0 0 22px;
  }

  /*
    Instagram's field: the placeholder is a label that shrinks into the top of the box once there is
    something in it, rather than vanishing the moment you type. It is done with :placeholder-shown
    rather than JavaScript, so the label follows the input's real state and cannot get out of step
    with it — including on autofill, which no keystroke handler ever hears about.
  */
  .field {
    position: relative;
    display: block;
    margin-bottom: 6px;
  }

  .field .input {
    width: 100%;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 13px;
    padding: 18px 14px 6px;
    height: 46px;
  }

  .field .label {
    position: absolute;
    left: 14px;
    top: 14px;
    font-size: 12px;
    color: var(--ink-3);
    pointer-events: none;
    transform-origin: left top;
    transition: transform 0.12s var(--ease), opacity 0.12s var(--ease);
  }

  /* Empty and unfocused: the label sits where the text would, and reads as a placeholder. */
  .field .input:placeholder-shown:not(:focus) + .label {
    transform: translateY(0) scale(1);
  }

  .field .input:not(:placeholder-shown) + .label,
  .field .input:focus + .label {
    transform: translateY(-8px) scale(0.75);
  }

  /* The reveal button on the password field, which the real one only shows once there is something
     to reveal. */
  .field .peek {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 8px;
  }

  .panel .btn {
    margin-top: 12px;
    padding: 12px 16px;
    font-size: 15px;
  }

  /* Says why the button under it cannot be pressed yet. */
  .await-code {
    color: var(--ink-3);
    font-size: 12px;
    line-height: 1.4;
    margin: 8px 0 0;
    text-align: center;
  }

  .error {
    color: var(--danger);
    font-size: 13px;
    line-height: 1.4;
    margin: 12px 0 2px;
  }

  .hint {
    color: var(--ink-3);
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    margin: 12px 0 0;
  }

  .hint a {
    color: var(--ink-2);
    font-weight: 600;
  }

  .alt {
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: var(--radius-lg);
    padding: 20px;
    text-align: center;
    margin-top: 10px;
    font-size: 14px;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 16px;
    color: var(--ink-3);
    font-size: 13px;
    font-weight: 600;
    margin: 18px 0;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .forgot {
    display: inline-block;
    color: var(--ink-2);
    font-size: 12px;
    margin-top: 14px;
  }

  /*
    The one thing on this page that is not Instagram's: a line saying what the app is, because a
    stranger looking at a sign-in box for something they have never heard of deserves to be told.
  */
  .pitch {
    margin-top: 10px;
    padding: 16px 20px;
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    text-align: center;
  }

  .pitch .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    background: var(--brand);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .pitch p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink-3);
  }

  .foot {
    margin: 28px 0 20px;
    text-align: center;
    color: var(--ink-3);
    font-size: 12px;
    line-height: 2;
  }

  .foot nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    justify-content: center;
    margin-bottom: 12px;
  }

  .foot nav span {
    color: var(--ink-3);
  }
`;
