/**
 * Decodes a JWT's payload and extracts the `exp` claim as a UNIX-ms timestamp.
 *
 * Uses only base64 decoding — no signature verification. Signature trust is
 * the backend's responsibility; this is a best-effort client-side hint for
 * deriving session expiry and scheduling the refresh timer.
 *
 * @param token - JWT string (`header.payload.signature`)
 * @returns UNIX-ms expiry, or `null` when the token is malformed / has no `exp`.
 */
export function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Handle both Node Buffer and browser atob environments.
    let json: string;
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(parts[1], 'base64').toString('utf-8');
    } else if (typeof atob === 'function') {
      json = atob(parts[1]);
    } else {
      return null;
    }

    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000; // seconds → ms
    }
    return null;
  } catch {
    return null;
  }
}
