import {
  buildCreateEscrowArgs,
  buildReleaseArgs,
  buildClaimArgs,
  buildFundArgs,
  buildDisputeArgs,
} from '../src/contract/build';
import { TrustFlowError } from '../src/errors';
import type { CreateEscrowParams } from '../src/types';

const VALID_ADDR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER_ADDR = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const BAD_CHECKSUM_G = 'G' + 'A'.repeat(55);
const BAD_CHECKSUM_C = 'C' + 'A'.repeat(55);

function createParams(over: Partial<CreateEscrowParams> = {}): CreateEscrowParams {
  return {
    sender: VALID_ADDR,
    recipient: OTHER_ADDR,
    amountStroops: 2_000_000n,
    durationBlocks: 100,
    ...over,
  } as CreateEscrowParams;
}

/**
 * #111 / #447 — the arg builders must reject a malformed address / escrowId with
 * a `TrustFlowError.validation(...)` before or during `new Address(...)`.
 */
describe('build.ts address / id validation (#111)', () => {
  describe('buildCreateEscrowArgs', () => {
    it('accepts valid addresses', () => {
      expect(() => buildCreateEscrowArgs(createParams())).not.toThrow();
    });
    it('rejects an invalid sender with a TrustFlowError', () => {
      expect(() => buildCreateEscrowArgs(createParams({ sender: 'not-an-address' }))).toThrow(
        TrustFlowError,
      );
    });
    it('rejects an invalid recipient with a TrustFlowError', () => {
      expect(() => buildCreateEscrowArgs(createParams({ recipient: 'GXXX' }))).toThrow(
        TrustFlowError,
      );
    });
  });

  describe('buildReleaseArgs', () => {
    it('accepts a valid escrowId + caller', () => {
      expect(() => buildReleaseArgs('esc-1', VALID_ADDR)).not.toThrow();
    });
    it('rejects an empty escrowId', () => {
      expect(() => buildReleaseArgs('', VALID_ADDR)).toThrow(TrustFlowError);
      expect(() => buildReleaseArgs('   ', VALID_ADDR)).toThrow(TrustFlowError);
    });
    it('rejects an invalid caller', () => {
      expect(() => buildReleaseArgs('esc-1', 'nope')).toThrow(TrustFlowError);
    });
  });

  describe('buildClaimArgs (#447)', () => {
    it('accepts a valid escrowId + claimant', () => {
      expect(() => buildClaimArgs('esc-1', VALID_ADDR)).not.toThrow();
    });
    it('rejects a malformed escrowId with TrustFlowError code VALIDATION_ERROR', () => {
      expect(() => buildClaimArgs('', VALID_ADDR)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'escrowId' }),
      );
      expect(() => buildClaimArgs('   ', VALID_ADDR)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'escrowId' }),
      );
    });
    it('rejects a malformed or bad-checksum claimant with TrustFlowError code VALIDATION_ERROR', () => {
      expect(() => buildClaimArgs('esc-1', 'nope')).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'claimant' }),
      );
      expect(() => buildClaimArgs('esc-1', BAD_CHECKSUM_G)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'claimant' }),
      );
    });
  });

  describe('buildFundArgs (#447)', () => {
    it('accepts a valid escrowId + funder and optional tokenAddress', () => {
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n)).not.toThrow();
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n, OTHER_ADDR)).not.toThrow();
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n, VALID_CONTRACT)).not.toThrow();
    });
    it('rejects a malformed escrowId with TrustFlowError code VALIDATION_ERROR', () => {
      expect(() => buildFundArgs('', VALID_ADDR, 1_000_000n)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'escrowId' }),
      );
    });
    it('rejects a malformed or bad-checksum funder with TrustFlowError code VALIDATION_ERROR', () => {
      expect(() => buildFundArgs('esc-1', 'bad-funder', 1_000_000n)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'funder' }),
      );
      expect(() => buildFundArgs('esc-1', BAD_CHECKSUM_G, 1_000_000n)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'funder' }),
      );
    });
    it('rejects a malformed or bad-checksum tokenAddress with TrustFlowError code VALIDATION_ERROR', () => {
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n, 'bad-token')).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'tokenAddress' }),
      );
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n, BAD_CHECKSUM_G)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'tokenAddress' }),
      );
      expect(() => buildFundArgs('esc-1', VALID_ADDR, 1_000_000n, BAD_CHECKSUM_C)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'tokenAddress' }),
      );
    });
  });

  describe('buildDisputeArgs', () => {
    it('accepts a valid escrowId and caller in both argument shapes', () => {
      expect(() => buildDisputeArgs('esc-1', VALID_ADDR)).not.toThrow();
      expect(() => buildDisputeArgs('esc-1', VALID_ADDR, 'goods not delivered')).not.toThrow();
    });
    it('rejects an empty escrowId', () => {
      expect(() => buildDisputeArgs('', VALID_ADDR)).toThrow(TrustFlowError);
    });
    it.each([
      ['two arguments', undefined],
      ['three arguments', 'goods not delivered'],
    ])('rejects a malformed caller in the %s shape with a validation error', (_shape, reason) => {
      try {
        buildDisputeArgs('esc-1', 'not-a-stellar-address', reason);
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TrustFlowError);
        expect((error as TrustFlowError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('validation errors are TrustFlowError.validation, not a raw @stellar/stellar-sdk error', () => {
    try {
      buildCreateEscrowArgs(createParams({ sender: 'bad' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TrustFlowError);
      expect((e as TrustFlowError).code).toBe('VALIDATION_ERROR');
    }
  });
});
