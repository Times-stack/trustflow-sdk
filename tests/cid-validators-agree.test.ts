import {
  assertValidCID,
  getCIDVersion,
  isValidCID,
  isValidCIDv0,
  isValidCIDv1,
} from '../src/utils/validation';
import { assertValidCid, getCidVersion, isValidCid } from '../src/storage/cid';

const V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const V1_DAG_PB = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
// Structurally valid CIDv1 with uncommon multicodecs (0x29 and 0x60).
const V1_CODEC_0X29 = 'baeureid2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pi';
const V1_CODEC_0X60 = 'bafqbeid2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pj5hu6t2pi';

describe('CID validators agree (#562)', () => {
  const inputs = [V0, V1_DAG_PB, V1_CODEC_0X29, V1_CODEC_0X60, 'invalid', '', 'bafy', 'Qm123'];

  it.each(inputs)('isValidCid and isValidCID agree for %p', (input) => {
    expect(isValidCID(input)).toBe(isValidCid(input));
  });

  it.each(inputs)('version getters agree and match v0/v1 helpers for %p', (input) => {
    expect(getCIDVersion(input)).toBe(getCidVersion(input));
    expect(isValidCIDv0(input)).toBe(getCidVersion(input) === 0);
    expect(isValidCIDv1(input)).toBe(getCidVersion(input) === 1);
  });

  it('accepts structurally valid CIDv1 strings with uncommon multicodecs', () => {
    for (const cid of [V1_CODEC_0X29, V1_CODEC_0X60]) {
      expect(isValidCid(cid)).toBe(true);
      expect(isValidCID(cid)).toBe(true);
      expect(isValidCIDv1(cid)).toBe(true);
      expect(isValidCIDv0(cid)).toBe(false);
      expect(getCIDVersion(cid)).toBe(1);
    }
  });

  it('assertValidCID and assertValidCid accept and reject the same inputs', () => {
    for (const input of inputs) {
      const lower = () => assertValidCid(input);
      const upper = () => assertValidCID(input);
      if (isValidCid(input)) {
        expect(lower).not.toThrow();
        expect(upper).not.toThrow();
      } else {
        expect(lower).toThrow();
        expect(upper).toThrow();
      }
    }
  });
});
