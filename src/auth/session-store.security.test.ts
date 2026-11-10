import * as fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt, decrypt } from './crypto.js';
import { assertLocalPath, secureDirectory } from '../security/windows-protection.js';
import * as log from '../utils/logger.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(), lstatSync: vi.fn(), readFileSync: vi.fn(),
  writeFileSync: vi.fn(), statSync: vi.fn(), unlinkSync: vi.fn(), rmSync: vi.fn(),
}));
vi.mock('./crypto.js', () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock('../security/windows-protection.js', () => ({
  assertLocalPath: vi.fn(), secureDirectory: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({ error: vi.fn() }));

type Store = typeof import('./session-store.js');
const emptySession = { cookies: [], origins: [] };
const emptyCache = { substrateToken: 'SYNTHETIC', substrateTokenExpiry: 0, extractedAt: 0 };
const operations: Array<[string, (store: Store) => unknown]> = [
  ['readSessionState', store => store.readSessionState()],
  ['readTokenCache', store => store.readTokenCache()],
  ['hasSessionState', store => store.hasSessionState()],
  ['getSessionAge', store => store.getSessionAge()],
  ['isSessionLikelyExpired', store => store.isSessionLikelyExpired()],
  ['writeSessionState', store => store.writeSessionState(emptySession)],
  ['writeTokenCache', store => store.writeTokenCache(emptyCache)],
  ['clearSessionState', store => store.clearSessionState()],
  ['clearTokenCache', store => store.clearTokenCache()],
  ['clearAllLocalData', store => store.clearAllLocalData()],
];
const fileOperations = [
  fs.existsSync, fs.lstatSync, fs.readFileSync, fs.writeFileSync, fs.statSync, fs.unlinkSync, fs.rmSync,
];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as fs.Stats);
  vi.mocked(fs.readFileSync).mockReturnValue('{}');
  vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);
  vi.mocked(decrypt).mockReturnValue(JSON.stringify(emptySession));
  vi.mocked(encrypt).mockReturnValue({ content: 'SYNTHETIC_CIPHERTEXT', version: 2 });
});

describe('protected credential storage', () => {
  it.each(operations)('validates the complete path before file access: %s', async (_name, operation) => {
    const store = await import('./session-store.js');
    operation(store);
    expect(assertLocalPath).toHaveBeenCalled();
    for (const access of fileOperations) {
      const mock = vi.mocked(access).mock;
      for (let index = 0; index < mock.calls.length; index++) {
        const filename = mock.calls[index][0];
        const validationIndex = vi.mocked(assertLocalPath).mock.calls.findIndex(call => call[0] === filename);
        expect(validationIndex, String(filename)).toBeGreaterThanOrEqual(0);
        expect(vi.mocked(assertLocalPath).mock.invocationCallOrder[validationIndex])
          .toBeLessThan(mock.invocationCallOrder[index]);
      }
    }
  });

  it.each(operations)('does not touch files when the path is rejected: %s', async (_name, operation) => {
    const store = await import('./session-store.js');
    vi.mocked(assertLocalPath).mockImplementation(() => {
      throw new Error('SYNTHETIC_REJECTED_PATH');
    });
    try { operation(store); } catch { /* Some public APIs fail by throwing; reads return null. */ }
    expect(assertLocalPath).toHaveBeenCalled();
    for (const access of fileOperations) expect(access).not.toHaveBeenCalled();
    expect(secureDirectory).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('revalidates the complete path even after the directory has been secured', async () => {
    const store = await import('./session-store.js');
    expect(store.readSessionState()).toEqual(emptySession);
    vi.mocked(assertLocalPath).mockImplementation(() => { throw new Error('SYNTHETIC_REPARSE_POINT'); });
    expect(store.readSessionState()).toBeNull();
    expect(fs.readFileSync).toHaveBeenCalledOnce();
    expect(assertLocalPath).toHaveBeenCalledTimes(2);
  });

  it('redacts malformed decrypted data from diagnostics', async () => {
    vi.mocked(decrypt).mockReturnValue('SYNTHETIC_SECRET_THAT_IS_NOT_JSON');
    const store = await import('./session-store.js');
    expect(store.readSessionState()).toBeNull();
    expect(log.error).toHaveBeenCalledWith('session-store',
      'Credential cache could not be read or decrypted.');
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('SYNTHETIC_SECRET');
  });

  it('resets credentials without deleting downloaded files and reapplies directory protection', async () => {
    const store = await import('./session-store.js');
    store.ensureConfigDir();
    store.clearAllLocalData();
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync).toHaveBeenCalledWith(store.SESSION_STATE_PATH);
    expect(fs.unlinkSync).toHaveBeenCalledWith(store.TOKEN_CACHE_PATH);
    expect(fs.rmSync).not.toHaveBeenCalled();
    store.ensureConfigDir();
    expect(secureDirectory).toHaveBeenCalledTimes(2);
  });
});
