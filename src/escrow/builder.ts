import { EscrowMilestone, EscrowParams } from '../types/index';
import { TrustFlowError } from '../errors';
import { assertStellarAddress, xlmToStroops } from '../utils/validation';
import { validateFutureExpiration } from '../utils/timezone';

export class EscrowBuilder {
  private params: Partial<EscrowParams> = {};
  private milestones: EscrowMilestone[] = [];

  setDepositor(address: string): this {
    this.params.depositor = address;
    return this;
  }
  withDepositor(address: string): this {
    return this.setDepositor(address);
  }

  setBeneficiary(address: string): this {
    this.params.beneficiary = address;
    return this;
  }
  withBeneficiary(address: string): this {
    return this.setBeneficiary(address);
  }

  setAmount(xlm: string): this {
    this.params.amountXLM = xlm;
    return this;
  }
  withAmount(xlm: string): this {
    return this.setAmount(xlm);
  }

  setToken(address: string): this {
    this.params.tokenAddress = address;
    return this;
  }
  withToken(address: string): this {
    return this.setToken(address);
  }

  setDeadline(blocks: number): this {
    this.params.deadlineBlocks = blocks;
    return this;
  }
  withDeadline(blocks: number): this {
    return this.setDeadline(blocks);
  }

  setArbitrator(address: string): this {
    this.params.arbitrator = address;
    return this;
  }
  withArbitrator(address: string): this {
    return this.setArbitrator(address);
  }

  addMilestone(milestone: {
    amount: bigint;
    description?: string;
    deadline?: Date | number | string;
  }): this {
    this.milestones.push({ ...milestone });
    return this;
  }

  /**
   * Validates the params set so far and returns them as an independent snapshot.
   *
   * The returned object is a copy, not a reference to the builder's internal
   * state, so later `set*`/`add*` calls and caller-side mutations of a built object
   * cannot affect the builder or any previously returned snapshot. That makes
   * a single builder safe to reuse as a template (for example one fixed
   * depositor) and call `build()` once per gig.
   *
   * @throws {TrustFlowError} `VALIDATION_ERROR` when `depositor`, `beneficiary`
   * or `amountXLM` is missing, when `depositor`, `beneficiary`, or `arbitrator` is invalid, when milestone
   * amounts are invalid/exceed total amount, or when milestone deadlines are
   * not chronological or in the past.
   */
  build(): EscrowParams {
    if (!this.params.depositor) {
      throw TrustFlowError.validation('depositor', 'depositor required');
    }
    assertStellarAddress(this.params.depositor, 'depositor');

    if (!this.params.beneficiary) {
      throw TrustFlowError.validation('beneficiary', 'beneficiary required');
    }
    assertStellarAddress(this.params.beneficiary, 'beneficiary');

    if (!this.params.amountXLM) {
      throw TrustFlowError.validation('amountXLM', 'amountXLM required');
    }

    if (this.params.arbitrator) {
      assertStellarAddress(this.params.arbitrator, 'arbitrator');
    }

    if (this.milestones.length > 0) {
      let sumMilestones = 0n;
      let lastDeadlineSec = -1;

      for (let i = 0; i < this.milestones.length; i++) {
        const m = this.milestones[i];
        if (m.amount === undefined || m.amount <= 0n) {
          throw TrustFlowError.validation(
            `milestones[${i}].amount`,
            'Milestone amount must be positive',
          );
        }
        sumMilestones += m.amount;

        if (m.deadline !== undefined) {
          let sec: number;
          try {
            sec = validateFutureExpiration(m.deadline, `milestones[${i}].deadline`);
          } catch (err: any) {
            throw TrustFlowError.validation(`milestones[${i}].deadline`, err.message);
          }
          if (sec <= lastDeadlineSec) {
            throw TrustFlowError.validation(
              `milestones[${i}].deadline`,
              `Milestones must be in chronological order: index ${i} (${sec}) <= previous (${lastDeadlineSec})`,
            );
          }
          lastDeadlineSec = sec;
        }
      }

      const totalStroops = xlmToStroops(this.params.amountXLM);
      if (sumMilestones > totalStroops) {
        throw TrustFlowError.validation(
          'milestones',
          `Milestone amounts sum (${sumMilestones}) exceeds total escrow amount (${totalStroops})`,
        );
      }
    }

    const result: EscrowParams = {
      ...this.params,
      depositor: this.params.depositor,
      beneficiary: this.params.beneficiary,
      amountXLM: this.params.amountXLM,
    };

    if (this.milestones.length > 0) {
      result.milestones = this.milestones.map((m) => ({ ...m }));
    }

    return result;
  }
}
