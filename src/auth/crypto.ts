/** Windows DPAPI; no key derived from public machine/account names. */
import { windowsProtection } from '../security/windows-protection.js';

export interface EncryptedData {
  content: string;
  version: number;
}

export function encrypt(plaintext: string): EncryptedData {
  return {
    content: windowsProtection('Protect', Buffer.from(plaintext, 'utf8')).toString('base64'),
    version: 2,
  };
}

export function decrypt(data: EncryptedData): string {
  if (data.version !== 2) {
    throw new Error('Legacy credential storage is not accepted. A new local login is required.');
  }
  return windowsProtection('Unprotect', Buffer.from(data.content, 'base64')).toString('utf8');
}
