/**
 * Getting an access token for a colleague's calendar.
 *
 * Google's domain-wide delegation works by us signing a short-lived assertion
 * that says "the service account, acting as sam@theirdomain, wants this
 * scope", and exchanging it for a token. The Workspace admin authorised the
 * service account for that one scope, so an assertion naming anybody outside
 * their domain is simply refused — the scoping is Google's, not ours, which is
 * exactly what you want of it.
 *
 * The signing is Web Crypto rather than a Google library: it is fifty lines,
 * it runs in the ordinary Convex runtime, and it saves carrying a dependency
 * that wants Node.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export type ServiceAccount = { clientEmail: string; privateKey: string };

/**
 * The service account from the environment, or null when it has not been set
 * up. Null is not an error: an organisation without calendar sync configured
 * should carry on working, silently, exactly as it did before.
 */
export function serviceAccountFromEnv(env: Record<string, string | undefined>): ServiceAccount | null {
  const clientEmail = env.GOOGLE_CALENDAR_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_CALENDAR_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  // Pasting a key into a dashboard field turns its newlines into "\n" more
  // often than not, and PEM parsing then fails in a way that reads as a bad
  // key rather than a mangled one.
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** The DER bytes out of a PEM private key. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * An access token good for writing to one person's calendar.
 *
 * `impersonate` is the whole point: the token is theirs, so the entry appears
 * on their calendar as their own rather than as an invitation from a stranger.
 */
export async function accessTokenFor(
  account: ServiceAccount,
  impersonate: string,
  now: number = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    iss: account.clientEmail,
    sub: impersonate,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson(claims)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.privateKey) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned) as unknown as ArrayBuffer
  );
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    // The usual causes are worth naming: this error is read by whoever set it
    // up, months after they last thought about it.
    throw new Error(
      `Google refused the token for ${impersonate} (${res.status}). ` +
        `Check the client ID is authorised for ${SCOPE} in the Workspace admin console, ` +
        `and that the address is in that domain. ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google returned no access token");
  return json.access_token;
}
