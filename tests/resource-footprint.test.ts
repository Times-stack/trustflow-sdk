import { xdr } from '@stellar/stellar-sdk';
import { TrustFlowClient } from '../src/client';
import {
  estimateResourceFootprint,
  parseResourceFootprint,
  TrustFlowContractClient,
} from '../src/contract';
import { TrustFlowError } from '../src/errors';

function makeReleaseSpecEntry(): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: 'Release escrow milestone',
      name: 'release_escrow',
      inputs: [
        new xdr.ScSpecFunctionInputV0({
          doc: 'Escrow ID',
          name: 'escrow_id',
          type: xdr.ScSpecTypeDef.scSpecTypeU64(),
        }),
      ],
      outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
    }),
  );
}

describe('Resource Footprint Estimation Helper (#372)', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
  let client: TrustFlowClient;

  beforeEach(() => {
    client = new TrustFlowClient({ contractId, network: 'TESTNET' });
  });

  describe('parseResourceFootprint', () => {
    it('parses cpuInsns, memBytes, and calculates fees in stroops and XLM', () => {
      const fixture = {
        cost: {
          cpuInsns: '1250000',
          memBytes: '20480',
        },
        minResourceFee: '45000',
      };

      const estimate = parseResourceFootprint(fixture);

      expect(estimate).toEqual({
        cpuInsns: '1250000',
        cpuInstructions: 1250000,
        cpuFormatted: '1,250,000 instructions',
        memBytes: '20480',
        ramBytes: 20480,
        ramFormatted: '20.00 KB',
        resourceFeeStroops: '45000',
        baseFeeStroops: '100',
        feeStroops: '45100',
        feeXLM: '0.00451',
      });
    });

    it('formats byte and megabyte RAM footprints and uses restorePreamble fee fallback', () => {
      const byteEstimate = parseResourceFootprint(
        {
          cost: { cpuInsns: '500', memBytes: '512' },
          restorePreamble: { minResourceFee: '9900' },
        },
        200,
      );

      expect(byteEstimate.ramFormatted).toBe('512 B');
      expect(byteEstimate.cpuFormatted).toBe('500 instructions');
      expect(byteEstimate.resourceFeeStroops).toBe('9900');
      expect(byteEstimate.baseFeeStroops).toBe('200');
      expect(byteEstimate.feeStroops).toBe('10100');
      expect(byteEstimate.feeXLM).toBe('0.00101');

      const mbEstimate = parseResourceFootprint({
        cost: { cpuInsns: '10000000', memBytes: String(2 * 1024 * 1024) },
        minResourceFee: '10000000',
      });

      expect(mbEstimate.ramFormatted).toBe('2.00 MB');
      expect(mbEstimate.feeStroops).toBe('10000100');
      expect(mbEstimate.feeXLM).toBe('1.00001');
    });
  });

  describe('estimateResourceFootprint & TrustFlowContractClient', () => {
    it('queries resource consumption prior to broadcasting via TrustFlowContractClient', async () => {
      const mockSorobanServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          cost: {
            cpuInsns: '842100',
            memBytes: '16384',
          },
          minResourceFee: '31900',
          result: {
            retval: xdr.ScVal.scvBool(true),
          },
        }),
      };
      jest.spyOn(client, 'getSorobanServer').mockReturnValue(mockSorobanServer as any);

      const contractClient = new TrustFlowContractClient(
        client,
        [makeReleaseSpecEntry()],
        contractId,
      );

      const footprint = await contractClient.estimateResourceFootprint('release_escrow', {
        escrow_id: 42n,
      });

      expect(mockSorobanServer.simulateTransaction).toHaveBeenCalledTimes(1);
      expect(footprint).toEqual({
        cpuInsns: '842100',
        cpuInstructions: 842100,
        cpuFormatted: '842,100 instructions',
        memBytes: '16384',
        ramBytes: 16384,
        ramFormatted: '16.00 KB',
        resourceFeeStroops: '31900',
        baseFeeStroops: '100',
        feeStroops: '32000',
        feeXLM: '0.0032',
      });
    });

    it('throws SIMULATION_ERROR when contract simulation returns an error', async () => {
      const mockSorobanServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          error: 'HostError: Error(Contract, #3)',
          cost: { cpuInsns: '0', memBytes: '0' },
        }),
      };
      jest.spyOn(client, 'getSorobanServer').mockReturnValue(mockSorobanServer as any);

      await expect(estimateResourceFootprint(client, 'AAAA...')).rejects.toThrow(TrustFlowError);
      await expect(estimateResourceFootprint(client, 'AAAA...')).rejects.toMatchObject({
        code: 'SIMULATION_ERROR',
      });
    });
  });
});
