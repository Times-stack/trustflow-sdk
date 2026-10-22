import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { encode } from 'cbor-x';
import { Keypair } from '@stellar/stellar-sdk';
import { WebAuthnManager, type WebAuthnCredentialOptions } from '../src/auth/webauthn';

const manager = new WebAuthnManager();
const challenge = Buffer.from('server-challenge').toString('base64url');
const origin = 'https://trustflow.example.com';
const rpId = 'trustflow.example.com';

function assertion(counter: number, privateKey: object, coseKey: Map<number, unknown>) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(rpId).digest(),
    Buffer.from([0x05]),
    Buffer.from([
      (counter >>> 24) & 0xff,
      (counter >>> 16) & 0xff,
      (counter >>> 8) & 0xff,
      counter & 0xff,
    ]),
  ]);
  const payload = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataJSON).digest(),
  ]);
  return {
    credential: {
      id: 'credential-1',
      publicKey: Buffer.from(encode(coseKey)).toString('base64url'),
      counter: counter - 1,
    } satisfies WebAuthnCredentialOptions,
    signature: {
      signature: sign('sha256', payload, { key: privateKey, dsaEncoding: 'der' }).toString(
        'base64url',
      ),
      counter,
      authenticatorData: authenticatorData.toString('base64url'),
      clientDataJSON: clientDataJSON.toString('base64url'),
    },
  };
}

function verificationOptions() {
  return { expectedChallenge: challenge, expectedOrigin: origin, rpId };
}

describe('WebAuthnManager', () => {
  it('derives a round-trippable keypair only with a private secret', () => {
    const credential = { id: 'credential-1', publicKey: 'public-key', counter: 0 };
    const result = manager.deriveSmartAccountKeypair(credential, 'dXNlcg', {
      secret: Buffer.alloc(32, 7),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Keypair.fromSecret(result.data.secret()).publicKey()).toBe(result.data.publicKey());
    expect(
      manager.deriveSmartAccountKeypair(credential, 'dXNlcg', { secret: Buffer.alloc(31) }).ok,
    ).toBe(false);
  });

  it('verifies a real ES256 WebAuthn assertion', async () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const data = assertion(
      1,
      keys.privateKey,
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    await expect(
      manager.verifySignature(data.credential, data.signature, verificationOptions()),
    ).resolves.toEqual({
      ok: true,
      data: { ...data.credential, counter: 1 },
    });
  });

  it('verifies a real RS256 WebAuthn assertion', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const data = assertion(
      2,
      keys.privateKey,
      new Map([
        [1, 3],
        [3, -257],
        [-1, Buffer.from(jwk.n!, 'base64url')],
        [-2, Buffer.from(jwk.e!, 'base64url')],
      ]),
    );
    await expect(
      manager.verifySignature(data.credential, data.signature, verificationOptions()),
    ).resolves.toMatchObject({
      ok: true,
      data: { counter: 2 },
    });
  });

  it.each([
    'garbage signature',
    'modified payload',
    'wrong challenge',
    'wrong origin',
    'wrong RP ID',
    'wrong public key',
    'stale counter',
    'counter mismatch',
    'missing required fields',
  ])('rejects %s', async (caseName) => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = keys.publicKey.export({ format: 'jwk' });
    const data = assertion(
      2,
      keys.privateKey,
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const response = { ...data.signature };
    const options = verificationOptions();
    if (caseName === 'garbage signature') response.signature = 'AAAA';
    if (caseName === 'modified payload')
      response.clientDataJSON = Buffer.from(
        JSON.stringify({ type: 'webauthn.get', challenge, origin, extra: true }),
      ).toString('base64url');
    if (caseName === 'wrong challenge') options.expectedChallenge = 'wrong';
    if (caseName === 'wrong origin') options.expectedOrigin = 'https://evil.example.com';
    if (caseName === 'wrong RP ID') options.rpId = 'evil.example.com';
    if (caseName === 'wrong public key') {
      const otherKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const otherJwk = otherKeys.publicKey.export({ format: 'jwk' });
      data.credential.publicKey = Buffer.from(
        encode(
          new Map([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, Buffer.from(otherJwk.x!, 'base64url')],
            [-3, Buffer.from(otherJwk.y!, 'base64url')],
          ]),
        ),
      ).toString('base64url');
    }
    if (caseName === 'stale counter') data.credential.counter = 2;
    if (caseName === 'counter mismatch') response.counter = 3;
    if (caseName === 'missing required fields')
      delete (response as Partial<typeof response>).clientDataJSON;
    await expect(
      manager.verifySignature(data.credential, response, options),
    ).resolves.toMatchObject({ ok: false });
  });
});
