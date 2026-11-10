import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/session-store.js', () => ({
  CONFIG_DIR: 'C:\\msteams-security-fixture',
  ensureConfigDir: vi.fn(),
}));
vi.mock('./windows-protection.js', () => ({ secureDirectory: vi.fn() }));

import { DOWNLOAD_DIR, resolveDownloadPath } from './download-policy.js';

describe('local download boundary', () => {
  it('accepts an ordinary file directly inside the download directory', () => {
    expect(resolveDownloadPath(join(DOWNLOAD_DIR, 'report.pdf'))).toBe(join(DOWNLOAD_DIR, 'report.pdf'));
  });

  it.each([
    '\\\\collector.invalid\\share\\file',
    '\\\\?\\UNC\\collector.invalid\\share\\file',
    '\\\\?\\C:\\msteams-security-fixture\\downloads\\file',
    'C:\\Users\\someone\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.cmd',
    'C:\\msteams-security-fixture\\downloads\\..\\escape.txt',
    'C:\\msteams-security-fixture\\downloads\\subdirectory\\file.txt',
    'C:\\msteams-security-fixture\\downloads\\report.txt:payload',
    'C:\\msteams-security-fixture\\downloads\\NUL.txt',
    'C:\\msteams-security-fixture\\downloads\\report.txt.',
    'relative.txt',
  ])('rejects network, device, traversal and special paths without opening them: %s', value => {
    expect(() => resolveDownloadPath(value)).toThrow();
  });
});
