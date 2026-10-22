import { Keypair } from '@stellar/stellar-sdk';
import { decode } from 'cbor-x';
import { TrustFlowError } from '../errors';
import type { SDKResult } from '../types/index';
import { logger } from '../utils/logger';
import { randomBytes } from '../utils/crypto';

export interface WebAuthnCredentialOptions {
  /** Credential ID (base64url encoded) returned from registration */
  id: string;
  /** Public key in COSE format (base64url encoded) */
  publicKey: string;
  /** Counter for signature validation */
  counter: number;
}

export interface WebAuthnRegistrationOptions {
  /** User ID (base64url encoded) */
  userId: string;
  /** User display name for the passkey */
  username: string;
  /** Relying party ID — typically the domain (e.g., "trustflow.example.com") */
  rpId: string;
  /** Relying party name */
  rpName?: string;
}

export interface WebAuthnSignatureResponse {
  /** Base64url encoded signature from WebAuthn */
  signature: string;
  /** Counter copied from authenticatorData by the caller. */
  counter: number;
  /** Base64url encoded authenticatorData. */
  authenticatorData: string;
  /** Base64url encoded clientDataJSON. */
  clientDataJSON: string;
  /** Optional attestation object retained for compatibility with registration flows. */
  attestationObject?: string;
}

export interface WebAuthnVerificationOptions {
  /** Base64url encoded, server-issued challenge that must be consumed once. */
  expectedChallenge: string;
  /** Exact origin expected in clientDataJSON. */
  expectedOrigin: string;
  /** Relying-party ID whose SHA-256 hash must prefix authenticatorData. */
  rpId: string;
  /** Require the user-verification flag in addition to user presence. */
  requireUserVerification?: boolean;
}

export interface WebAuthnKeyDerivationOptions {
  /** Private secret kept outside the credential and user-controlled public inputs. */
  secret: Uint8Array;
}

/**
 * Manages WebAuthn passkey registration and authentication for Soroban smart accounts.
 * Enables passwordless, phishing-resistant authentication using platform authenticators.
 */
export class WebAuthnManager {
  /**
   * Creates a registration challenge for a new WebAuthn passkey.
   *
   * @param options - Registration configuration including user and RP information
   * @returns Challenge data to be passed to the authenticator
   * @throws {TrustFlowError} if challenge creation fails
   *
   * @example
   * ```typescript
   * const challenge = webAuthnManager.createRegistrationChallenge({
   *   userId: btoa('user-123'),
   *   username: 'alice@example.com',
   *   rpId: 'trustflow.example.com',
   *   rpName: 'TrustFlow',
   * });
   * ```
   */
  createRegistrationChallenge(
    options: WebAuthnRegistrationOptions,
  ): SDKResult<PublicKeyCredentialCreationOptions> {
    try {
      // WebCrypto-first with a Node fallback, from the shared helper — the
      // previous inline window/require branching duplicated that logic here.
      // The copy into a fresh Uint8Array keeps the ArrayBuffer-backed type
      // PublicKeyCredentialCreationOptions expects.
      const challenge = new Uint8Array(randomBytes(32));

      const credentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: options.rpName || 'TrustFlow',
          id: options.rpId,
        },
        user: {
          id: Uint8Array.from(Buffer.from(options.userId, 'base64')),
          name: options.username,
          displayName: options.username,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      };

      logger.debug('WebAuthn registration challenge created', { rpId: options.rpId });
      return {
        ok: true,
        data: credentialCreationOptions,
      };
    } catch (e) {
      logger.error('Failed to create WebAuthn registration challenge', { error: e });
      return {
        ok: false,
        error: TrustFlowError.wrap(e, 'AUTH_ERROR').message,
      };
    }
  }

  /**
   * Derives a Soroban smart account keypair from a WebAuthn credential.
   * Creates a deterministic keypair using a private application secret and the
   * credential identity. Public credential data and user ID alone are not a
   * secret and must never be used to derive an account key.
   *
   * @param credential - Registered WebAuthn credential
   * @param userId - User ID used during registration (base64url encoded)
   * @param options - Secret-backed derivation configuration
   * @returns Keypair for use as a Soroban smart account
   * @throws {TrustFlowError} if keypair derivation fails
   *
   * @example
   * ```typescript
   * const keypair = webAuthnManager.deriveSmartAccountKeypair(credential, userId, { secret });
   * const accountAddress = keypair.publicKey(); // Use as Soroban smart account
   * ```
   */
  deriveSmartAccountKeypair(
    credential: WebAuthnCredentialOptions,
    userId: string,
    options: WebAuthnKeyDerivationOptions,
  ): SDKResult<Keypair> {
    try {
      // HMAC-SHA256 is synchronous, so Node's crypto module is required here
      // (WebCrypto's subtle.digest/hmac are async-only and this method is
      // sync by contract). Lazy require keeps bundlers from seeing a static
      // Node built-in import.
      const modName = 'crypto';
      const req = typeof require !== 'undefined' ? require : undefined;
      const nodeCrypto = req ? req(modName) : undefined;
      if (!nodeCrypto) {
        throw new Error('WebAuthn keypair derivation requires the Node.js crypto module');
      }

      if (!options?.secret || options.secret.length < 32) {
        throw TrustFlowError.validation(
          'secret',
          'A private secret of at least 32 bytes is required for key derivation',
        );
      }

      // The private secret is the HMAC key. Credential and user identifiers are
      // public context only and cannot independently derive the account key.
      const hmac = nodeCrypto.createHmac('sha256', Buffer.from(options.secret));
      hmac.update('trustflow-webauthn-account-v2');
      hmac.update(Buffer.from(userId, 'base64url'));
      hmac.update(credential.publicKey);
      hmac.update(credential.id);
      const seed = hmac.digest(); // 32 bytes — exactly an ed25519 seed

      // Create a keypair from the derived raw seed. (This previously fed a
      // 33-byte Buffer into `Keypair.fromSecret`, which expects a strkey
      // string, so derivation always failed at runtime.)
      const keypair = Keypair.fromRawEd25519Seed(seed);

      logger.debug('WebAuthn smart account keypair derived', { credentialId: credential.id });
      return {
        ok: true,
        data: keypair,
      };
    } catch (e) {
      logger.error('Failed to derive WebAuthn smart account keypair', { error: e });
      return {
        ok: false,
        error: TrustFlowError.wrap(e, 'AUTH_ERROR').message,
      };
    }
  }

  /**
   * Verifies a complete WebAuthn assertion and updates the credential counter.
   * The challenge must be fresh and consumed by the server integration layer.
   *
   * @param credential - Registered credential to verify against
   * @param signature - Complete assertion response from authentication
   * @param options - Server-issued challenge and relying-party expectations
   * @returns Updated credential with incremented counter on success
   * @throws {TrustFlowError} if verification fails or counter is not monotonically increasing
   *
   * @example
   * ```typescript
   * const updated = await webAuthnManager.verifySignature(credential, signatureResponse, {
   *   expectedChallenge,
   *   expectedOrigin: 'https://trustflow.example.com',
   *   rpId: 'trustflow.example.com',
   * });
   * if (updated.ok) {
   *   // Update stored credential with new counter
   *   credential.counter = updated.data.counter;
   * }
   * ```
   */
  async verifySignature(
    credential: WebAuthnCredentialOptions,
    signature: WebAuthnSignatureResponse,
    options: WebAuthnVerificationOptions,
  ): Promise<SDKResult<WebAuthnCredentialOptions>> {
    try {
      const modName = 'crypto';
      const req = typeof require !== 'undefined' ? require : undefined;
      const nodeCrypto = req ? req(modName) : undefined;
      if (!nodeCrypto) {
        throw new Error('WebAuthn assertion verification requires the Node.js crypto module');
      }
      if (
        !credential.publicKey ||
        !signature.signature ||
        !signature.authenticatorData ||
        !signature.clientDataJSON ||
        !options?.expectedChallenge ||
        !options.expectedOrigin ||
        !options.rpId
      ) {
        throw new Error('WebAuthn assertion is missing required verification fields');
      }

      const decodeBase64Url = (value: string): Buffer => {
        if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
        return Buffer.from(value, 'base64url');
      };
      const clientDataBytes = decodeBase64Url(signature.clientDataJSON);
      const authenticatorData = decodeBase64Url(signature.authenticatorData);
      const signatureBytes = decodeBase64Url(signature.signature);
      if (authenticatorData.length < 37 || signatureBytes.length === 0) {
        throw new Error('Invalid WebAuthn assertion encoding');
      }

      const clientData = JSON.parse(clientDataBytes.toString('utf8')) as {
        type?: unknown;
        challenge?: unknown;
        origin?: unknown;
      };
      if (
        clientData.type !== 'webauthn.get' ||
        clientData.challenge !== options.expectedChallenge ||
        clientData.origin !== options.expectedOrigin
      ) {
        throw new Error('WebAuthn client data does not match the expected assertion');
      }

      const crypto = nodeCrypto;
      const expectedRpIdHash = crypto.createHash('sha256').update(options.rpId).digest();
      if (!crypto.timingSafeEqual(authenticatorData.subarray(0, 32), expectedRpIdHash)) {
        throw new Error('WebAuthn relying-party ID hash mismatch');
      }

      const flags = authenticatorData[32];
      if ((flags & 0x01) === 0 || (options.requireUserVerification && (flags & 0x04) === 0)) {
        throw new Error('WebAuthn authenticator flags are insufficient');
      }
      const authenticatorCounter = authenticatorData.readUInt32BE(33);
      if (
        !Number.isSafeInteger(signature.counter) ||
        signature.counter !== authenticatorCounter ||
        authenticatorCounter <= credential.counter
      ) {
        throw new Error(
          `WebAuthn counter ${signature.counter} does not match or exceed stored counter ${credential.counter}`,
        );
      }

      const coseKey = decode(decodeBase64Url(credential.publicKey)) as Map<number, unknown>;
      const algorithm = coseKey.get(3);
      const keyType = coseKey.get(1);
      let publicKey: unknown;
      let verifyOptions: Record<string, unknown> = {};
      if (algorithm === -7 && keyType === 2) {
        const x = coseKey.get(-2);
        const y = coseKey.get(-3);
        if (
          !(x instanceof Uint8Array) ||
          !(y instanceof Uint8Array) ||
          x.length !== 32 ||
          y.length !== 32
        ) {
          throw new Error('Invalid ES256 COSE public key');
        }
        publicKey = crypto.createPublicKey({
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: Buffer.from(x).toString('base64url'),
            y: Buffer.from(y).toString('base64url'),
          },
          format: 'jwk',
        });
        verifyOptions = { dsaEncoding: 'der' };
      } else if (algorithm === -257 && keyType === 3) {
        const n = coseKey.get(-1);
        const e = coseKey.get(-2);
        if (
          !(n instanceof Uint8Array) ||
          !(e instanceof Uint8Array) ||
          n.length === 0 ||
          e.length === 0
        ) {
          throw new Error('Invalid RS256 COSE public key');
        }
        publicKey = crypto.createPublicKey({
          key: {
            kty: 'RSA',
            n: Buffer.from(n).toString('base64url'),
            e: Buffer.from(e).toString('base64url'),
          },
          format: 'jwk',
        });
      } else {
        throw new Error('Unsupported or inconsistent WebAuthn COSE algorithm');
      }

      const clientDataHash = crypto.createHash('sha256').update(clientDataBytes).digest();
      const signedPayload = Buffer.concat([authenticatorData, clientDataHash]);
      if (
        !crypto.verify(
          'sha256',
          signedPayload,
          { key: publicKey, ...verifyOptions },
          signatureBytes,
        )
      ) {
        throw new Error('WebAuthn signature verification failed');
      }

      // Return updated credential with new counter
      const updated: WebAuthnCredentialOptions = {
        ...credential,
        counter: signature.counter,
      };

      logger.debug('WebAuthn signature verified', {
        credentialId: credential.id,
        counter: signature.counter,
      });
      return {
        ok: true,
        data: updated,
      };
    } catch (e) {
      logger.error('WebAuthn signature verification failed', { error: e });
      return {
        ok: false,
        error: TrustFlowError.wrap(e, 'AUTH_ERROR').message,
      };
    }
  }
}
