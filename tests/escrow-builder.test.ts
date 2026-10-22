import { Keypair } from '@stellar/stellar-sdk';
import { EscrowBuilder } from '../src/escrow/builder';
import { TrustFlowError } from '../src/errors';

const DEPOSITOR = Keypair.random().publicKey();
const BENEFICIARY = Keypair.random().publicKey();
const ARBITRATOR = Keypair.random().publicKey();
const TOKEN = Keypair.random().publicKey();

describe('EscrowBuilder', () => {
  it('builds a standard escrow configuration using set* methods', () => {
    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100.50')
      .setToken(TOKEN)
      .setDeadline(500);

    const escrow = builder.build();

    expect(escrow).toEqual({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '100.50',
      tokenAddress: TOKEN,
      deadlineBlocks: 500,
    });
  });

  it('supports fluent with* methods, multi-milestone chains, and arbitrator', () => {
    const future1 = new Date(Date.now() + 100_000);
    const future2 = new Date(Date.now() + 200_000);

    const m1 = { amount: 500_000_000n, description: 'Phase 1', deadline: future1 };
    const m2 = { amount: 500_000_000n, description: 'Phase 2', deadline: future2 };

    const escrow = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100')
      .addMilestone(m1)
      .addMilestone(m2)
      .withArbitrator(ARBITRATOR)
      .build();

    expect(escrow.depositor).toBe(DEPOSITOR);
    expect(escrow.beneficiary).toBe(BENEFICIARY);
    expect(escrow.amountXLM).toBe('100');
    expect(escrow.arbitrator).toBe(ARBITRATOR);
    expect(escrow.milestones).toHaveLength(2);
    expect(escrow.milestones![0]).toEqual(m1);
    expect(escrow.milestones![1]).toEqual(m2);
  });

  it('rejects an invalid depositor address with VALIDATION_ERROR', () => {
    const builder = new EscrowBuilder()
      .setDepositor('invalid-stellar-address')
      .setBeneficiary(BENEFICIARY)
      .setAmount('100');

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.field).toBe('depositor');
    }
  });

  it('rejects an invalid beneficiary address with VALIDATION_ERROR', () => {
    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary('invalid-stellar-address')
      .setAmount('100');

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.field).toBe('beneficiary');
    }
  });

  it('rejects an invalid arbitrator address with VALIDATION_ERROR', () => {
    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100')
      .withArbitrator('invalid-stellar-address');

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.field).toBe('arbitrator');
    }
  });

  it('rejects milestone amounts exceeding total escrow amount with VALIDATION_ERROR', () => {
    // 10 XLM = 100_000_000 stroops
    const m1 = { amount: 60_000_000n };
    const m2 = { amount: 50_000_000n }; // sum = 110_000_000 > 100_000_000

    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('10')
      .addMilestone(m1)
      .addMilestone(m2);

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.field).toBe('milestones');
    }
  });

  it('rejects milestone with zero or negative amount with VALIDATION_ERROR', () => {
    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100')
      .addMilestone({ amount: 0n });

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects non-chronological milestone deadlines with VALIDATION_ERROR', () => {
    const future1 = new Date(Date.now() + 200_000);
    const future2 = new Date(Date.now() + 100_000); // earlier than future1!

    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100')
      .addMilestone({ amount: 10_000_000n, deadline: future1 })
      .addMilestone({ amount: 10_000_000n, deadline: future2 });

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects past milestone deadlines with VALIDATION_ERROR', () => {
    const past = new Date(Date.now() - 50_000);

    const builder = new EscrowBuilder()
      .setDepositor(DEPOSITOR)
      .setBeneficiary(BENEFICIARY)
      .setAmount('100')
      .addMilestone({ amount: 10_000_000n, deadline: past });

    expect(() => builder.build()).toThrow(TrustFlowError);
    try {
      builder.build();
    } catch (err: any) {
      expect(err.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns an independent copy safe from subsequent builder mutations', () => {
    const builder = new EscrowBuilder()
      .withDepositor(DEPOSITOR)
      .withBeneficiary(BENEFICIARY)
      .withAmount('100');

    const first = builder.build();
    builder.withAmount('200');
    builder.addMilestone({ amount: 50_000_000n });

    expect(first.amountXLM).toBe('100');
    expect(first.milestones).toBeUndefined();
  });
});
