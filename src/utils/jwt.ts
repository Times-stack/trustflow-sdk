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
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      json = atob(padded);
    } else {
      return null;
    }

    const payload = JSON.parse(json) as { exp?: unknown } | null;
    if (
      payload &&
      typeof payload === 'object' &&
      typeof payload.exp === 'number' &&
      Number.isFinite(payload.exp)
    ) {
      return payload.exp * 1000; // seconds → ms
    }
    return null;
  } catch {
    return null;
  }
}
