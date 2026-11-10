import { describe, expect, it } from 'vitest';
import { encrypt, decrypt } from './crypto.js';

describe('Windows DPAPI credentials', () => {
  it.each(['', 'SYNTHETIC_ONLY', '{"refreshToken":"SYNTHETIC_ONLY"}', 'Příliš žluťoučký 🐎'])(
    'round-trips synthetic content without a machine-name key', plaintext => {
      const encrypted = encrypt(plaintext);
      expect(encrypted.version).toBe(2);
      expect(decrypt(encrypted)).toBe(plaintext);
      expect(encrypted.content).not.toBe(plaintext);
    },
  );

  it('rejects a modified DPAPI blob', () => {
    const encrypted = encrypt('SYNTHETIC_ONLY');
    const bytes = Buffer.from(encrypted.content, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    expect(() => decrypt({ version: 2, content: bytes.toString('base64') })).toThrow();
  });

  it('refuses the old predictable-key format', () => {
    expect(() => decrypt({ version: 1, content: '' })).toThrow(/Legacy/);
  });
});
