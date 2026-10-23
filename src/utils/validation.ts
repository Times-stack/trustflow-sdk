import { TrustFlowError } from '../errors';
import { toBaseUnits } from './format';
import { CID_V0_REGEX, assertValidCid, getCidVersion, isValidCid } from '../storage/cid';

export const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
export const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const XLM_AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

/**
 * CIDv0 regex (base58btc, starts with Qm, 46 chars).
 *
 * @deprecated Alias of `CID_V0_REGEX` from the storage module. CID validation
 * lives in `src/storage/cid.ts`; use `isValidCid` rather than matching regexes.
 */
export const CID_V0_RE = CID_V0_REGEX;

export function isValidStellarAddress(value: string): boolean {
  return STELLAR_ADDRESS_RE.test(value);
}

export function isValidContractId(value: string): boolean {
  return CONTRACT_ID_RE.test(value);
}

/**
 * Validates a Stellar address of any kind (account `G...` or contract `C...`).
 *
 * @param value - Address string to validate
 * @returns true if valid Stellar account address or contract ID
 *
 * @example
 * ```ts
 * isValidAddress('G...'); // true for valid account
 * isValidAddress('C...'); // true for valid contract
 * isValidAddress('invalid'); // false
 * ```
 */
export function isValidAddress(value: string): boolean {
  return (
    typeof value === 'string' && (STELLAR_ADDRESS_RE.test(value) || CONTRACT_ID_RE.test(value))
  );
}

export function isValidXLMAmount(value: string): boolean {
  if (!XLM_AMOUNT_RE.test(value)) {
    return false;
  }
  const n = parseFloat(value);
  return n > 0 && n <= 500_000_000;
}

export function assertStellarAddress(value: string, field = 'address'): void {
  if (!isValidStellarAddress(value)) {
    throw TrustFlowError.validation(field, `Invalid Stellar address for "${field}": ${value}`);
  }
}

export function xlmToStroops(xlm: string | number): bigint {
  return toBaseUnits(typeof xlm === 'string' ? xlm : String(xlm), 7);
}

export function isValidEscrowId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 128 &&
    !/[/?#]/.test(value)
  );
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidBase64(value: string): boolean {
  return (
    typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && BASE64_RE.test(value)
  );
}

export function isValidBlockCount(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 1_000_000;
}

export function sanitizeString(value: string, maxLength = 256): string {
  return value
    .replace(/[<>"']/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates a CID (Content Identifier) string.
 *
 * Delegates to {@link isValidCid} in `src/storage/cid.ts`, the single CID
 * validator: it decodes the CID and checks its structure, so any multicodec is
 * accepted. `isValidCID` and `isValidCid` always agree.
 *
 * @param value - CID string to validate
 * @returns true if valid CID, false otherwise
 *
 * @example
 * ```ts
 * isValidCID('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'); // true (CIDv0)
 * isValidCID('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'); // true (CIDv1)
 * isValidCID('invalid'); // false
 * ```
 */
export function isValidCID(value: string): boolean {
  return isValidCid(value);
}

/**
 * Validates a CIDv0 string (base58btc encoded, starts with Qm).
 *
 * @param value - CIDv0 string to validate
 * @returns true if valid CIDv0, false otherwise
 */
export function isValidCIDv0(value: string): boolean {
  return getCidVersion(value) === 0;
}

/**
 * Validates a CIDv1 string (any multibase and multicodec accepted by
 * {@link isValidCid}).
 *
 * @param value - CIDv1 string to validate
 * @returns true if valid CIDv1, false otherwise
 */
export function isValidCIDv1(value: string): boolean {
  return getCidVersion(value) === 1;
}

/**
 * Asserts that a value is a valid CID, throwing if not.
 *
 * @param value - CID string to validate
 * @param field - Field name for error message (default: 'cid')
 * @throws {TrustFlowError} If the value is not a valid CID
 */
export function assertValidCID(value: string, field = 'cid'): void {
  assertValidCid(value, field);
}

/**
 * Extracts the CID version (0 or 1) from a CID string.
 *
 * @param value - CID string
 * @returns 0 for CIDv0, 1 for CIDv1, null if invalid
 */
export function getCIDVersion(value: string): 0 | 1 | null {
  return getCidVersion(value);
}
