import { connectWallet, disconnectWallet, normalizeWalletNetwork } from '../src/wallet';
import { getFreighter, isFreighterInstalled } from '../src/wallet/freighter';
import { getAlbedo } from '../src/wallet/albedo';
import { TrustFlowError } from '../src/errors';

describe('wallet module', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset global window before each test
    global.window = undefined as any;
  });

  afterAll(() => {
    global.window = originalWindow;
  });

  describe('when window is undefined (Node environment)', () => {
    it('getFreighter returns null', () => {
      expect(getFreighter()).toBeNull();
    });

    it('isFreighterInstalled returns false', async () => {
      await expect(isFreighterInstalled()).resolves.toBe(false);
    });

    it('getAlbedo returns null', () => {
      expect(getAlbedo()).toBeNull();
    });
  });

  describe('when window is defined but wallets are not installed', () => {
    beforeEach(() => {
      global.window = {} as any;
    });

    it('getFreighter returns null', () => {
      expect(getFreighter()).toBeNull();
    });

    it('isFreighterInstalled returns false', async () => {
      await expect(isFreighterInstalled()).resolves.toBe(false);
    });

    it('getAlbedo returns null', () => {
      expect(getAlbedo()).toBeNull();
    });
  });

  describe('when wallets are installed', () => {
    const mockFreighter = {
      getPublicKey: jest.fn().mockResolvedValue('GBM...'),
      getNetwork: jest.fn().mockResolvedValue('TESTNET'),
    };
    const mockAlbedo = {
      publicKey: jest.fn().mockResolvedValue({ pubkey: 'GBA...' }),
    };

    beforeEach(() => {
      global.window = {
        freighter: mockFreighter,
        albedo: mockAlbedo,
      } as any;
    });

    it('getFreighter returns the freighter instance wrapper', () => {
      const freighterWrapper = getFreighter();
      expect(freighterWrapper).toBeDefined();
      expect(freighterWrapper?.isAvailable()).toBe(true);
    });

    it('isFreighterInstalled returns true', async () => {
      await expect(isFreighterInstalled()).resolves.toBe(true);
    });

    it('getAlbedo returns the albedo instance', () => {
      expect(getAlbedo()).toBe(mockAlbedo);
    });
  });

  describe('normalizeWalletNetwork', () => {
    it.each([
      ['public', 'MAINNET'],
      ['PUBLIC', 'MAINNET'],
      ['pubnet', 'MAINNET'],
      ['PUBNET', 'MAINNET'],
      ['mainnet', 'MAINNET'],
      ['testnet', 'TESTNET'],
      ['futurenet', 'FUTURENET'],
      ['', 'TESTNET'],
      [undefined, 'TESTNET'],
    ])('normalizes %p to %p', (input, expected) => {
      expect(normalizeWalletNetwork(input)).toBe(expected);
    });
  });

  describe('connectWallet', () => {
    beforeEach(() => {
      global.window = undefined as any;
    });

    it('throws UNAUTHORIZED if freighter is not installed', async () => {
      await expect(connectWallet('freighter')).rejects.toMatchObject(
        new TrustFlowError('Freighter not installed', 'UNAUTHORIZED'),
      );
    });

    it('throws UNAUTHORIZED if albedo is not available', async () => {
      await expect(connectWallet('albedo')).rejects.toMatchObject(
        new TrustFlowError('Albedo not available', 'UNAUTHORIZED'),
      );
    });

    it('throws UNAUTHORIZED if wallet type is unsupported', async () => {
      // @ts-expect-error Testing invalid wallet type
      await expect(connectWallet('unsupported')).rejects.toMatchObject(
        new TrustFlowError('Wallet type unsupported not supported', 'UNAUTHORIZED'),
      );
    });

    it('connects to freighter successfully when installed', async () => {
      const mockFreighter = {
        getPublicKey: jest.fn().mockResolvedValue('GBM...'),
        getNetwork: jest.fn().mockResolvedValue('TESTNET'),
      };
      global.window = { freighter: mockFreighter } as any;

      const connection = await connectWallet('freighter');
      expect(connection).toEqual({
        type: 'freighter',
        publicKey: 'GBM...',
        network: 'TESTNET',
      });
    });

    it('normalizes PUBLIC from freighter to MAINNET', async () => {
      const mockFreighter = {
        getPublicKey: jest.fn().mockResolvedValue('GBM...'),
        getNetwork: jest.fn().mockResolvedValue('PUBLIC'),
      };
      global.window = { freighter: mockFreighter } as any;

      const connection = await connectWallet('freighter');
      expect(connection).toEqual({
        type: 'freighter',
        publicKey: 'GBM...',
        network: 'MAINNET',
      });
    });

    it('connects to albedo on a non-testnet network reported in publicKey response', async () => {
      const mockAlbedo = {
        publicKey: jest.fn().mockResolvedValue({
          pubkey: 'GBALBEDO123',
          token: 'tok',
          network: 'public',
        }),
      };
      global.window = { albedo: mockAlbedo } as any;

      const connection = await connectWallet('albedo');
      expect(connection).toEqual({
        type: 'albedo',
        publicKey: 'GBALBEDO123',
        network: 'MAINNET',
      });
    });

    it('connects to albedo and normalizes pubnet/futurenet from getNetwork()', async () => {
      const mockAlbedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: 'GBALBEDO456', token: 'tok' }),
        getNetwork: jest.fn().mockResolvedValue('pubnet'),
      };
      global.window = { albedo: mockAlbedo } as any;

      const connection = await connectWallet('albedo');
      expect(mockAlbedo.getNetwork).toHaveBeenCalledTimes(1);
      expect(connection).toEqual({
        type: 'albedo',
        publicKey: 'GBALBEDO456',
        network: 'MAINNET',
      });
    });

    it('defaults albedo network to TESTNET when neither publicKey nor getNetwork reports a network', async () => {
      const mockAlbedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: 'GBALBEDO789', token: 'tok' }),
      };
      global.window = { albedo: mockAlbedo } as any;

      const connection = await connectWallet('albedo');
      expect(connection).toEqual({
        type: 'albedo',
        publicKey: 'GBALBEDO789',
        network: 'TESTNET',
      });
    });

    it('falls back to TESTNET when albedo getNetwork() rejects after publicKey() succeeds', async () => {
      const mockAlbedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: 'GBALBEDO999', token: 'tok' }),
        getNetwork: jest.fn().mockRejectedValue(new Error('getNetwork not supported')),
      };
      global.window = { albedo: mockAlbedo } as any;

      const connection = await connectWallet('albedo');
      expect(connection).toEqual({
        type: 'albedo',
        publicKey: 'GBALBEDO999',
        network: 'TESTNET',
      });
    });

    it('throws USER_REJECTED if albedo publicKey returns no pubkey', async () => {
      const mockAlbedo = {
        publicKey: jest.fn().mockResolvedValue({ pubkey: '', token: '' }),
      };
      global.window = { albedo: mockAlbedo } as any;

      await expect(connectWallet('albedo')).rejects.toMatchObject({
        code: 'USER_REJECTED',
      });
    });
  });

  describe('disconnectWallet', () => {
    it('is a no-op that resolves successfully', async () => {
      await expect(disconnectWallet()).resolves.toBeUndefined();
    });
  });
});
