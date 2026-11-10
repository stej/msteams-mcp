/**
 * Nonpersistent browser contexts: raw cookies/MSAL storage are not kept in a
 * reusable browser profile. Only the DPAPI-protected session is persisted.
 */
import { chromium, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';
import { ensureConfigDir, readSessionState, writeSessionState } from '../auth/session-store.js';
import { clearRegionCache } from '../utils/auth-guards.js';

export interface BrowserManager {
  context: BrowserContext;
  page: Page;
}

export async function createBrowserContext(
  { headless = true }: { headless?: boolean } = {}
): Promise<BrowserManager> {
  ensureConfigDir();
  const browser = await chromium.launch({
    headless,
    channel: 'chrome',
  });
  try {
    const state = readSessionState();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      storageState: state ? state as BrowserContextOptions['storageState'] : undefined,
    });
    const page = await context.newPage();
    return { context, page };
  } catch {
    await browser.close();
    throw new Error('Could not create the isolated Teams browser context.');
  }
}

export async function saveSessionState(context: BrowserContext): Promise<void> {
  writeSessionState(await context.storageState());
  clearRegionCache();
}

export async function closeBrowser(manager: BrowserManager, saveSession = true): Promise<void> {
  const browser = manager.context.browser();
  try {
    if (saveSession) await saveSessionState(manager.context);
  } finally {
    try {
      await manager.context.close();
    } finally {
      await browser?.close();
    }
  }
}
