/**
 * Authentication-related tool handlers.
 */

import { createRequire } from 'module';
import { isReadOnly } from '../security/access-policy.js';
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RegisteredTool, ToolResult } from './index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };
import {
  hasSessionState,
  isSessionLikelyExpired,
  clearAllLocalData,
} from '../auth/session-store.js';
import {
  getSubstrateTokenStatus,
  getMessageAuthStatus,
  extractMessageAuth,
  extractCsaToken,
  extractSubstrateToken,
  extractSkypeSpacesToken,
} from '../auth/token-extractor.js';
import { refreshTokensViaHttp } from '../auth/token-refresh-http.js';
import { createBrowserContext, closeBrowser } from '../browser/context.js';
import * as log from '../utils/logger.js';
import { resetAssignmentsAvailability, clearRegionCache } from '../utils/auth-guards.js';
import { ensureAuthenticated } from '../browser/auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const LoginInputSchema = z.object({
  forceNew: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const loginToolDefinition: Tool = {
  name: 'teams_login',
  description: 'Trigger manual login flow for Microsoft Teams. Use this if the session has expired or you need to switch accounts.',
  inputSchema: {
    type: 'object',
    properties: {
      forceNew: {
        type: 'boolean',
        description: 'Delete all previous login data (browser profile, cookies, saved session, every previously signed-in account) and sign in from scratch in a visible browser. Use to switch accounts or recover a broken session (default: false)',
      },
    },
  },
};

const statusToolDefinition: Tool = {
  name: 'teams_status',
  description: 'Check the current authentication status and session state.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum minutes remaining on token to consider it valid (skip browser). */
const TOKEN_VALID_THRESHOLD_MINUTES = 10;

/** Every core credential a session needs: search, calendar, favourites, messaging. */
function coreCredentialsComplete(): boolean {
  return extractSubstrateToken() !== null
    && extractSkypeSpacesToken() !== null
    && extractCsaToken() !== null
    && extractMessageAuth() !== null;
}

/**
 * Mints any core credential the browser did not leave in the saved session.
 *
 * Teams JS acquires some resource tokens lazily — the CSA (chatsvcagg) token
 * behind favourites is routinely absent from a session saved straight after
 * SSO, so login would report success while teams_status reported favourites
 * unavailable until some later call happened to trigger a refresh. One HTTP
 * exchange mints every core resource. Failure is non-fatal: the session is
 * still usable and the next tool call retries through auto-login.
 */
async function fillCoreCredentialGaps(): Promise<void> {
  if (coreCredentialsComplete()) return;

  const result = await refreshTokensViaHttp();
  if (!result.ok) {
    log.warn('login', `Could not top up core credentials: ${result.error.message}`);
  }
}

/** Fixed categories keep URLs, tokens and arbitrary browser error text out of diagnostics. */
function loginFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Authentication timeout:')) return 'manual-login-timeout';
  if (message.includes('MSAL token refresh timed out')) return 'token-refresh-timeout';
  if (message.includes('Target page, context or browser has been closed')) return 'browser-target-closed';
  const networkError = /\bnet::(ERR_[A-Z0-9_]+)\b/.exec(message)?.[1];
  if (networkError) {
    const codes = new Set(['ERR_ABORTED', 'ERR_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED',
      'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
      'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED', 'ERR_BLOCKED_BY_CLIENT',
      'ERR_BLOCKED_BY_ADMINISTRATOR', 'ERR_CERT_AUTHORITY_INVALID',
      'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID']);
    return codes.has(networkError) ? networkError : 'network-error';
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'browser-timeout';
  if (message.includes('Windows credential or local-path protection failed')) return 'credential-storage-failed';
  return 'authentication-failed';
}

/** Authentication saves its own session. Cleanup must never save again or mask its failure. */
async function authenticateInBrowser(headless: boolean): Promise<void> {
  const mode = headless ? 'headless' : 'visible';
  const phases = new Map([
    ['Navigating to Teams...', 'navigation'],
    ['Waiting for manual login...', 'sign-in'],
    ['Authentication successful!', 'token-wait'],
    ['Waiting for MSAL to refresh tokens...', 'token-wait'],
    ['Teams loaded — saving session state.', 'session-save'],
    ['Saving session state...', 'session-save'],
    ['Session state saved.', 'authenticated'],
  ]);
  let phase = 'opening-browser';
  let manager: Awaited<ReturnType<typeof createBrowserContext>> | undefined;
  let contextClosed = false;
  let closing = false;
  let failure: Error | undefined;
  log.info('login:' + mode, 'phase=' + phase);
  try {
    manager = await createBrowserContext({ headless });
    const browser = manager.context.browser();
    const lifecycle = (event: string) => {
      const message = 'event=' + event + '; expected=' + closing + '; phase=' + phase;
      if (closing) log.info('login:' + mode, message);
      else log.warn('login:' + mode, message);
    };
    manager.page.on('close', () => lifecycle('page-closed'));
    manager.context.on('close', () => { contextClosed = true; lifecycle('context-closed'); });
    browser?.on('disconnected', () => lifecycle('browser-disconnected'));
    await ensureAuthenticated(manager.page, manager.context, message => {
      const next = phases.get(message);
      if (next && next !== phase) {
        phase = next;
        log.info('login:' + mode, 'phase=' + phase);
      }
    }, !headless, headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const candidate = /^([A-Za-z]+\.[A-Za-z]+):/.exec(message)?.[1] ?? '';
    const operations = new Set(['page.goto', 'page.waitForTimeout', 'page.evaluate', 'browserContext.storageState']);
    const operation = operations.has(candidate) ? candidate : 'authentication';
    const browser = manager?.context.browser();
    const state = manager
      ? '; pageClosed=' + manager.page.isClosed() + '; contextClosed=' + contextClosed
        + '; browserDisconnected=' + (!browser || !browser.isConnected())
      : '';
    failure = new Error('Teams login failed: mode=' + mode + '; phase=' + phase
      + '; operation=' + operation + '; reason=' + loginFailureReason(error) + state);
    log.warn('login:' + mode, failure.message);
  } finally {
    closing = true;
    phase = 'cleanup';
    if (manager) {
      try {
        await closeBrowser(manager, false);
      } catch {
        log.warn('login:' + mode, 'phase=cleanup; reason=cleanup-failed');
        failure ??= new Error('Teams login failed: mode=' + mode + '; phase=cleanup; reason=cleanup-failed');
      }
    }
  }
  if (failure) throw failure;
}

async function handleLogin(
  input: z.infer<typeof LoginInputSchema>,
): Promise<ToolResult> {
  // A fresh login may have changed what the account can access (e.g. new consent)
  resetAssignmentsAvailability();

  if (input.forceNew) {
    // Start from nothing: no profile, cookies, MSAL cache or session from any
    // earlier account can survive to be mixed into the new login.
    clearAllLocalData();
    clearRegionCache();
    return loginInVisibleBrowser();
  }

  // Fast path: if tokens are still valid, skip browser entirely
  const tokenStatus = getSubstrateTokenStatus();
  if (tokenStatus.hasToken && tokenStatus.minutesRemaining! >= TOKEN_VALID_THRESHOLD_MINUTES) {
    await fillCoreCredentialGaps();
    return {
      success: true,
      data: {
        message: `Already authenticated. Token valid for ${tokenStatus.minutesRemaining} more minutes.`,
        tokenStatus: {
          expiresAt: tokenStatus.expiresAt,
          minutesRemaining: tokenStatus.minutesRemaining,
        },
      },
    };
  }

  // Headless-first strategy:
  // Restore Microsoft's session cookies from the protected storage state into
  // a nonpersistent context. No reusable browser profile is retained.
  try {
    await authenticateInBrowser(true);
    await fillCoreCredentialGaps();

    return {
      success: true,
      data: {
        message: 'Login completed silently via SSO. Session has been saved.',
      },
    };
  } catch {
    log.warn('login:headless', 'Headless login did not complete; opening visible sign-in.');
  }

  return loginInVisibleBrowser();
}

/** Opens a visible browser for the user to sign in, then saves the session. */
async function loginInVisibleBrowser(): Promise<ToolResult> {
  await authenticateInBrowser(false);

  await fillCoreCredentialGaps();

  return {
    success: true,
    data: {
      message: 'Login completed successfully. Session has been saved.',
    },
  };
}

async function handleStatus(): Promise<ToolResult> {
  const tokenStatus = getSubstrateTokenStatus();
  const messageAuthStatus = getMessageAuthStatus();

  return {
    success: true,
    data: {
      version: pkg.version,
      accessMode: isReadOnly() ? 'readOnly' : 'fullAccess',
      directApi: {
        available: tokenStatus.hasToken,
        expiresAt: tokenStatus.expiresAt,
        minutesRemaining: tokenStatus.minutesRemaining,
      },
      messaging: {
        available: messageAuthStatus.hasToken,
        expiresAt: messageAuthStatus.expiresAt,
        minutesRemaining: messageAuthStatus.minutesRemaining,
      },
      favorites: {
        available: extractMessageAuth() !== null && extractCsaToken() !== null,
      },
      session: {
        exists: hasSessionState(),
        likelyExpired: isSessionLikelyExpired(),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const loginTool: RegisteredTool<typeof LoginInputSchema> = {
  definition: loginToolDefinition,
  schema: LoginInputSchema,
  handler: handleLogin,
};

export const statusTool: RegisteredTool<z.ZodObject<Record<string, never>>> = {
  definition: statusToolDefinition,
  schema: z.object({}),
  handler: handleStatus,
};

/** All auth-related tools. */
export const authTools = [loginTool, statusTool];
