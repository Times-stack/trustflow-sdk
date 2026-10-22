import {
  StellarAddressSchema,
  ContractIdSchema,
  StroopsSchema,
  NetworkSchema,
  CreateEscrowSchema,
  ReleaseEscrowSchema,
  DisputeEscrowSchema,
  ClientConfigSchema,
  TrustFlowClient,
} from '../src';

const ADDR_A = 'G' + 'A'.repeat(55);
const ADDR_B = 'G' + 'B'.repeat(55);
const CONTRACT_ID = 'C' + 'A'.repeat(55);

describe('exported Zod schemas', () => {
  it('are reachable from the package root (not just src/schemas)', () => {
    expect(StellarAddressSchema).toBeDefined();
    expect(CreateEscrowSchema).toBeDefined();
  });

  describe('StellarAddressSchema', () => {
    it('accepts a well-formed address', () => {
      expect(StellarAddressSchema.safeParse(ADDR_A).success).toBe(true);
    });

    it.each(['not-an-address', 'A' + 'A'.repeat(55), 'G' + 'A'.repeat(54)])(
      'rejects %s',
      (value) => {
        expect(StellarAddressSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('ContractIdSchema', () => {
    it('accepts a well-formed contract id', () => {
      expect(ContractIdSchema.safeParse(CONTRACT_ID).success).toBe(true);
    });

    it('rejects an address prefixed with G instead of C', () => {
      expect(ContractIdSchema.safeParse(ADDR_A).success).toBe(false);
    });
  });

  describe('StroopsSchema', () => {
    it('accepts a positive bigint', () => {
      expect(StroopsSchema.safeParse(1_000_000n).success).toBe(true);
    });

    it('rejects zero, negative, and non-bigint values', () => {
      expect(StroopsSchema.safeParse(0n).success).toBe(false);
      expect(StroopsSchema.safeParse(-1n).success).toBe(false);
      expect(StroopsSchema.safeParse(1000).success).toBe(false);
    });
  });

  describe('NetworkSchema', () => {
    it.each(['MAINNET', 'TESTNET', 'FUTURENET', 'LOCALNET'])('accepts %s', (network) => {
      expect(NetworkSchema.safeParse(network).success).toBe(true);
    });

    it('rejects an unsupported network', () => {
      expect(NetworkSchema.safeParse('DEVNET').success).toBe(false);
      expect(NetworkSchema.safeParse('UNKNOWN_NET').success).toBe(false);
    });
  });

  describe('CreateEscrowSchema', () => {
    it('parses valid input and defaults network to TESTNET', () => {
      const result = CreateEscrowSchema.parse({
        sender: ADDR_A,
        recipient: ADDR_B,
        amount: 1_000_000n,
      });
      expect(result.network).toBe('TESTNET');
    });

    it('rejects a memo longer than 28 characters', () => {
      const result = CreateEscrowSchema.safeParse({
        sender: ADDR_A,
        recipient: ADDR_B,
        amount: 1_000_000n,
        memo: 'x'.repeat(29),
      });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid sender address', () => {
      const result = CreateEscrowSchema.safeParse({
        sender: 'not-an-address',
        recipient: ADDR_B,
        amount: 1_000_000n,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReleaseEscrowSchema', () => {
    it('parses valid input', () => {
      const result = ReleaseEscrowSchema.safeParse({ escrowId: 'escrow-1', recipient: ADDR_A });
      expect(result.success).toBe(true);
    });

    it('rejects an empty escrowId', () => {
      const result = ReleaseEscrowSchema.safeParse({ escrowId: '', recipient: ADDR_A });
      expect(result.success).toBe(false);
    });
  });

  describe('DisputeEscrowSchema', () => {
    it('rejects a reason shorter than 10 characters', () => {
      const result = DisputeEscrowSchema.safeParse({ escrowId: 'escrow-1', reason: 'too short' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid reason and optional evidence URL', () => {
      const result = DisputeEscrowSchema.safeParse({
        escrowId: 'escrow-1',
        reason: 'work was never delivered',
        evidence: 'https://example.com/proof.png',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a malformed evidence URL', () => {
      const result = DisputeEscrowSchema.safeParse({
        escrowId: 'escrow-1',
        reason: 'work was never delivered',
        evidence: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ClientConfigSchema', () => {
    it('parses valid config and defaults network to TESTNET', () => {
      const result = ClientConfigSchema.parse({ contractId: CONTRACT_ID });
      expect(result.network).toBe('TESTNET');
    });

    it('rejects an invalid rpcUrl', () => {
      const result = ClientConfigSchema.safeParse({ contractId: CONTRACT_ID, rpcUrl: 'nope' });
      expect(result.success).toBe(false);
    });

    it('rejects a missing contractId', () => {
      const result = ClientConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('preserves timeoutMs, retry, accounts, rpcServer, horizonServer, and ipfs options for TrustFlowClient (#437)', () => {
      const mockRpcServer = { getHealth: jest.fn() };
      const mockHorizonServer = { loadAccount: jest.fn() };
      const rawConfig = {
        contractId: CONTRACT_ID,
        network: 'TESTNET' as const,
        timeoutMs: 15_000,
        retry: {
          retries: 4,
          retryDelayMs: 300,
          maxRetryDelayMs: 3_000,
          jitter: false,
        },
        accounts: [
          {
            address: ADDR_A,
            label: 'Alice',
            roles: ['depositor'],
            data: { tier: 'gold' },
          },
          {
            address: ADDR_B,
            label: 'Bob',
            roles: ['beneficiary'],
            activate: false,
          },
        ],
        ipfs: {
          gatewayUrl: 'https://w3s.link/ipfs',
          fallbackGateways: ['https://ipfs.io/ipfs'],
          timeoutMs: 8_000,
          retry: { retries: 2 },
        },
        rpcServer: mockRpcServer as any,
        horizonServer: mockHorizonServer as any,
      };

      const parsed = ClientConfigSchema.safeParse(rawConfig);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.timeoutMs).toBe(15_000);
      expect(parsed.data.retry).toEqual({
        retries: 4,
        retryDelayMs: 300,
        maxRetryDelayMs: 3_000,
        jitter: false,
      });
      expect(parsed.data.accounts).toHaveLength(2);
      expect(parsed.data.accounts?.[0]?.address).toBe(ADDR_A);
      expect(parsed.data.rpcServer).toBe(mockRpcServer);
      expect(parsed.data.horizonServer).toBe(mockHorizonServer);
      expect(parsed.data.ipfs?.fallbackGateways).toEqual(['https://ipfs.io/ipfs']);

      const client = new TrustFlowClient(parsed.data);
      expect(client.timeoutMs).toBe(15_000);
      expect(client.accounts.list()).toHaveLength(2);
      expect(client.accounts.active?.address).toBe(ADDR_A);
      expect(client.getSorobanServer()).toBe(mockRpcServer);
    });

    it('rejects invalid timeoutMs, retry, accounts address, or non-object servers (#437)', () => {
      expect(ClientConfigSchema.safeParse({ contractId: CONTRACT_ID, timeoutMs: 0 }).success).toBe(
        false,
      );
      expect(
        ClientConfigSchema.safeParse({ contractId: CONTRACT_ID, timeoutMs: -100 }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          retry: { retries: -1 },
        }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          accounts: [{ address: 'not-a-stellar-address' }],
        }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          rpcServer: 'not-an-object',
        }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          horizonServer: null,
        }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          rpcServer: [],
        }).success,
      ).toBe(false);
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          retry: { retries: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
        }).success,
      ).toBe(true);
      expect(() => new TrustFlowClient({ contractId: CONTRACT_ID, timeoutMs: -100 })).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' }),
      );
      expect(
        () => new TrustFlowClient({ contractId: CONTRACT_ID, retry: { retries: -1 } }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    });
  });
});
