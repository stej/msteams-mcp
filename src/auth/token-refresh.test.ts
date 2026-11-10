import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./token-extractor.js', () => ({
  extractSubstrateToken: vi.fn(),
}));
vi.mock('./session-store.js', () => ({ clearTokenCache: vi.fn() }));
vi.mock('../browser/context.js', () => ({ createBrowserContext: vi.fn(), closeBrowser: vi.fn() }));
vi.mock('../browser/auth.js', () => ({ ensureAuthenticated: vi.fn() }));
vi.mock('./token-refresh-http.js', () => ({ refreshTokensViaHttp: vi.fn() }));

import { refreshTokensViaBrowser } from './token-refresh.js';
import { extractSubstrateToken } from './token-extractor.js';
import { refreshTokensViaHttp } from './token-refresh-http.js';
import { createBrowserContext, closeBrowser } from '../browser/context.js';
import { ensureAuthenticated } from '../browser/auth.js';
import { clearTokenCache } from './session-store.js';
import { createError, ErrorCode } from '../types/errors.js';
import { err, ok } from '../types/result.js';

const token = { token: 'SYNTHETIC_ACCESS_TOKEN', expiry: new Date(Date.now() + 3600000) };
const browser = { page: {}, context: {} } as Awaited<ReturnType<typeof createBrowserContext>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MSTEAMS_ACCESS_MODE', undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('refreshTokensViaBrowser', () => {
  it('uses HTTP refresh after the cached access token has expired', async () => {
    vi.mocked(extractSubstrateToken).mockReturnValue(token);
    vi.mocked(refreshTokensViaHttp).mockResolvedValue(ok(undefined));
    expect(await refreshTokensViaBrowser()).toEqual(ok(undefined));
    expect(refreshTokensViaHttp).toHaveBeenCalledOnce();
    expect(createBrowserContext).not.toHaveBeenCalled();
  });

  describe.each([undefined, 'readOnly'])('browser fallback disabled with mode %s', mode => {
    it.each([ErrorCode.AUTH_EXPIRED, ErrorCode.AUTH_REQUIRED, ErrorCode.NETWORK_ERROR])(
      'does not open a browser after HTTP failure: %s', async code => {
        vi.stubEnv('MSTEAMS_ACCESS_MODE', mode);
        const failure = err(createError(code, 'SYNTHETIC_HTTP_FAILURE'));
        vi.mocked(refreshTokensViaHttp).mockResolvedValue(failure);
        expect(await refreshTokensViaBrowser()).toEqual(failure);
        expect(refreshTokensViaHttp).toHaveBeenCalledOnce();
        expect(createBrowserContext).not.toHaveBeenCalled();
        expect(ensureAuthenticated).not.toHaveBeenCalled();
        expect(closeBrowser).not.toHaveBeenCalled();
        expect(clearTokenCache).not.toHaveBeenCalled();
      });

    it('does not open a browser when HTTP succeeds without a usable token', async () => {
      vi.stubEnv('MSTEAMS_ACCESS_MODE', mode);
      vi.mocked(refreshTokensViaHttp).mockResolvedValue(ok(undefined));
      vi.mocked(extractSubstrateToken).mockReturnValue(null);
      const result = await refreshTokensViaBrowser();
      expect(result).toMatchObject({
        ok: false, error: { code: ErrorCode.AUTH_INTERACTION_REQUIRED, retryable: false },
      });
      if (!result.ok) expect(result.error.message).toContain('disabled in readOnly mode');
      expect(createBrowserContext).not.toHaveBeenCalled();
      expect(ensureAuthenticated).not.toHaveBeenCalled();
    });
  });

  it.each(['http-failure', 'missing-token'])('retains fallback only in fullAccess: %s', async trigger => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'fullAccess');
    vi.mocked(refreshTokensViaHttp).mockResolvedValue(trigger === 'http-failure'
      ? err(createError(ErrorCode.AUTH_EXPIRED, 'SYNTHETIC_HTTP_FAILURE')) : ok(undefined));
    if (trigger === 'missing-token') vi.mocked(extractSubstrateToken).mockReturnValueOnce(null);
    vi.mocked(extractSubstrateToken).mockReturnValue(token);
    vi.mocked(createBrowserContext).mockResolvedValue(browser);
    expect(await refreshTokensViaBrowser()).toEqual(ok(undefined));
    expect(createBrowserContext).toHaveBeenCalledExactlyOnceWith({ headless: true });
    expect(ensureAuthenticated).toHaveBeenCalledWith(browser.page, browser.context, expect.any(Function), false, true);
    expect(closeBrowser).toHaveBeenCalledWith(browser, false);
    expect(clearTokenCache).toHaveBeenCalledOnce();
  });
});
