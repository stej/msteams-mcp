import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../auth/session-store.js', () => ({
  hasSessionState: vi.fn(() => true),
  isSessionLikelyExpired: vi.fn(() => false),
  clearAllLocalData: vi.fn(),
}));

vi.mock('../auth/token-extractor.js', () => ({
  getSubstrateTokenStatus: vi.fn(),
  getMessageAuthStatus: vi.fn(),
  extractMessageAuth: vi.fn(),
  extractCsaToken: vi.fn(),
  extractSubstrateToken: vi.fn(),
  extractSkypeSpacesToken: vi.fn(),
}));

vi.mock('../auth/token-refresh-http.js', () => ({ refreshTokensViaHttp: vi.fn() }));
vi.mock('../browser/context.js', () => ({ createBrowserContext: vi.fn(), closeBrowser: vi.fn() }));
vi.mock('../browser/auth.js', () => ({ ensureAuthenticated: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../utils/auth-guards.js', () => ({ resetAssignmentsAvailability: vi.fn(), clearRegionCache: vi.fn() }));

import { loginTool } from './auth-tools.js';
import { clearAllLocalData } from '../auth/session-store.js';
import {
  getSubstrateTokenStatus,
  extractMessageAuth,
  extractCsaToken,
  extractSubstrateToken,
  extractSkypeSpacesToken,
} from '../auth/token-extractor.js';
import { refreshTokensViaHttp } from '../auth/token-refresh-http.js';
import { createBrowserContext, closeBrowser } from '../browser/context.js';
import { ensureAuthenticated } from '../browser/auth.js';
import * as log from '../utils/logger.js';

function browserFixture() {
  const state = { pageClosed: false, connected: true };
  const page = Object.assign(new EventEmitter(), { isClosed: () => state.pageClosed });
  const browser = Object.assign(new EventEmitter(), { isConnected: () => state.connected });
  const context = Object.assign(new EventEmitter(), { browser: () => browser });
  const manager = { page, context } as unknown as Awaited<ReturnType<typeof createBrowserContext>>;
  return { manager, page, browser, context, state };
}

/** A session holding every core credential except the CSA (favourites) token. */
function sessionMissingCsaToken(): void {
  vi.mocked(getSubstrateTokenStatus).mockReturnValue({ hasToken: true, minutesRemaining: 60 });
  vi.mocked(extractSubstrateToken).mockReturnValue({ token: 'substrate', expiry: new Date(Date.now() + 3.6e6) });
  vi.mocked(extractSkypeSpacesToken).mockReturnValue('spaces');
  vi.mocked(extractMessageAuth).mockReturnValue({ skypeToken: 's', authToken: 'a', userMri: '8:orgid:u' });
  vi.mocked(extractCsaToken).mockReturnValue(null);
}

describe('teams_login core credential top-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refreshTokensViaHttp).mockResolvedValue({ ok: true, value: undefined });
  });

  it('mints the missing CSA token when the session is otherwise valid', async () => {
    sessionMissingCsaToken();

    const result = await loginTool.handler({ forceNew: false });

    expect(result.success).toBe(true);
    expect(refreshTokensViaHttp).toHaveBeenCalledOnce();
    expect(createBrowserContext).not.toHaveBeenCalled();
  });

  it('skips the refresh when every core credential is present', async () => {
    sessionMissingCsaToken();
    vi.mocked(extractCsaToken).mockReturnValue('csa');

    await loginTool.handler({ forceNew: false });

    expect(refreshTokensViaHttp).not.toHaveBeenCalled();
  });

  it('tops up after a forced browser login leaves the CSA token behind', async () => {
    sessionMissingCsaToken();
    vi.mocked(createBrowserContext).mockResolvedValue(browserFixture().manager);
    vi.mocked(closeBrowser).mockResolvedValue(undefined as never);

    const result = await loginTool.handler({ forceNew: true });

    expect(result.success).toBe(true);
    expect(refreshTokensViaHttp).toHaveBeenCalledOnce();
  });

  it('forceNew wipes all previous login data and signs in from scratch in a visible browser', async () => {
    sessionMissingCsaToken();
    vi.mocked(extractCsaToken).mockReturnValue('csa');
    vi.mocked(createBrowserContext).mockResolvedValue(browserFixture().manager);
    vi.mocked(closeBrowser).mockResolvedValue(undefined as never);

    await loginTool.handler({ forceNew: true });

    expect(clearAllLocalData).toHaveBeenCalledOnce();
    expect(vi.mocked(clearAllLocalData).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(createBrowserContext).mock.invocationCallOrder[0]);
    // Valid-looking tokens from the old session must not short-circuit the login,
    // and a wiped profile has nothing for headless SSO to use.
    expect(createBrowserContext).toHaveBeenCalledOnce();
    expect(createBrowserContext).toHaveBeenCalledWith({ headless: false });
  });

  it('still reports success when the top-up fails', async () => {
    sessionMissingCsaToken();
    vi.mocked(refreshTokensViaHttp).mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    } as never);

    const result = await loginTool.handler({ forceNew: false });

    expect(result.success).toBe(true);
  });
});

describe('teams_login browser cleanup and safe diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSubstrateTokenStatus).mockReturnValue({ hasToken: false });
    vi.mocked(refreshTokensViaHttp).mockResolvedValue({ ok: true, value: undefined });
  });

  it('preserves the original login failure when cleanup also fails', async () => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    vi.mocked(ensureAuthenticated).mockRejectedValue(
      new Error('Authentication timeout: SYNTHETIC_ORIGINAL_SECRET'));
    vi.mocked(closeBrowser).mockRejectedValue(new Error('storageState: SYNTHETIC_CLEANUP_SECRET'));

    const result = loginTool.handler({ forceNew: true });
    await expect(result).rejects.toThrow('reason=manual-login-timeout');
    await expect(result).rejects.not.toThrow('SYNTHETIC');
    expect(closeBrowser).toHaveBeenCalledExactlyOnceWith(fixture.manager, false);
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('SYNTHETIC');
  });

  it('does not resave the visible session during successful cleanup', async () => {
    sessionMissingCsaToken();
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    expect(await loginTool.handler({ forceNew: true })).toMatchObject({ success: true });
    expect(closeBrowser).toHaveBeenCalledExactlyOnceWith(fixture.manager, false);
  });

  it('does not resave the headless session during successful cleanup', async () => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    expect(await loginTool.handler({ forceNew: false })).toMatchObject({ success: true });
    expect(createBrowserContext).toHaveBeenCalledExactlyOnceWith({ headless: true });
    expect(closeBrowser).toHaveBeenCalledExactlyOnceWith(fixture.manager, false);
    expect(clearAllLocalData).not.toHaveBeenCalled();
  });

  it('records the original operation and unexpected closure without recording secrets or URLs', async () => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    vi.mocked(ensureAuthenticated).mockImplementation(async (_page, _context, progress) => {
      progress?.('Waiting for manual login...');
      progress?.('https://collector.invalid/?token=SYNTHETIC_PROGRESS_SECRET');
      fixture.state.pageClosed = true;
      fixture.page.emit('close');
      fixture.context.emit('close');
      fixture.state.connected = false;
      fixture.browser.emit('disconnected');
      throw new Error('page.waitForTimeout: Target page, context or browser has been closed; SYNTHETIC_TOKEN');
    });
    const result = loginTool.handler({ forceNew: true });
    await expect(result).rejects.toThrow('phase=sign-in; operation=page.waitForTimeout; reason=browser-target-closed');
    await expect(result).rejects.toThrow('pageClosed=true; contextClosed=true; browserDisconnected=true');
    await expect(result).rejects.not.toThrow('SYNTHETIC');
    const logs = JSON.stringify([...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]);
    expect(logs).toContain('expected=false');
    expect(logs).not.toMatch(/SYNTHETIC|collector/);
    expect(closeBrowser).toHaveBeenCalledWith(fixture.manager, false);
  });

  it.each([
    ['page.goto: net::ERR_ABORTED at https://collector.invalid/?token=SYNTHETIC_TOKEN', 'ERR_ABORTED'],
    ['page.goto: net::ERR_SYNTHETIC_SECRET at https://collector.invalid/', 'network-error'],
  ])('only returns allowlisted network error codes: %s', async (message, reason) => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    vi.mocked(ensureAuthenticated).mockImplementation(async (_page, _context, progress) => {
      progress?.('Navigating to Teams...');
      throw new Error(message);
    });
    const result = loginTool.handler({ forceNew: true });
    await expect(result).rejects.toThrow('phase=navigation; operation=page.goto; reason=' + reason);
    await expect(result).rejects.not.toThrow('SYNTHETIC');
  });

  it('identifies a session-save failure without exposing the raw exception', async () => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    vi.mocked(ensureAuthenticated).mockImplementation(async (_page, _context, progress) => {
      progress?.('Saving session state...');
      throw new Error('browserContext.storageState: SYNTHETIC_RAW_SECRET');
    });
    const result = loginTool.handler({ forceNew: true });
    await expect(result).rejects.toThrow('phase=session-save; operation=browserContext.storageState');
    await expect(result).rejects.not.toThrow('SYNTHETIC');
  });

  it('reports a cleanup failure after successful login as cleanup, not authentication', async () => {
    const fixture = browserFixture();
    vi.mocked(createBrowserContext).mockResolvedValue(fixture.manager);
    vi.mocked(closeBrowser).mockRejectedValue(new Error('SYNTHETIC_CLEANUP_SECRET'));
    const result = loginTool.handler({ forceNew: true });
    await expect(result).rejects.toThrow('phase=cleanup; reason=cleanup-failed');
    await expect(result).rejects.not.toThrow('SYNTHETIC');
  });
});
