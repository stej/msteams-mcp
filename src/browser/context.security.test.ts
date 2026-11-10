import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  page: {},
  state: { cookies: [], origins: [] },
  closeBrowser: vi.fn(),
  closeContext: vi.fn(),
  newContext: vi.fn(),
  persistent: vi.fn(),
}));
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newContext: fixtures.newContext,
      close: fixtures.closeBrowser,
    })),
    launchPersistentContext: fixtures.persistent,
  },
}));
vi.mock('../auth/session-store.js', () => ({
  ensureConfigDir: vi.fn(),
  readSessionState: () => fixtures.state,
  writeSessionState: vi.fn(),
}));
vi.mock('../utils/auth-guards.js', () => ({ clearRegionCache: vi.fn() }));

import { createBrowserContext, closeBrowser } from './context.js';

describe('nonpersistent login storage', () => {
  it('restores an in-memory session without opening a persistent profile', async () => {
    fixtures.newContext.mockResolvedValue({
      newPage: async () => fixtures.page,
      close: fixtures.closeContext,
      browser: () => ({ close: fixtures.closeBrowser }),
    });
    const manager = await createBrowserContext();
    expect(fixtures.newContext).toHaveBeenCalledWith(expect.objectContaining({
      storageState: fixtures.state, acceptDownloads: false,
    }));
    expect(fixtures.persistent).not.toHaveBeenCalled();
    await closeBrowser(manager, false);
    expect(fixtures.closeContext).toHaveBeenCalled();
    expect(fixtures.closeBrowser).toHaveBeenCalled();
  });
});
