/**
 * The VAPID keys that prove a storm alert really comes from DooFah. Made once
 * with `npx web-push generate-vapid-keys` and kept only in Vercel:
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY (built into the page; public by design),
 * VAPID_PRIVATE_KEY (server only) and VAPID_SUBJECT (a contact for the push
 * services: an https: address or a mailto:). Never change the pair once
 * people subscribe: every subscription is tied to the public key.
 */

export interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * The keys, or null when push isn't set up (the push routes then answer 503).
 * They are passed with each send (`vapidDetails`) rather than set globally,
 * so tests can use their own pair.
 */
export function vapidFrom(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  // Apple refuses any other kind of subject, and web-push throws on one.
  if (!/^(https:\/\/|mailto:)/.test(subject)) return null;
  return { subject, publicKey, privateKey };
}
