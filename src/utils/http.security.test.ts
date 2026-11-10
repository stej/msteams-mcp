import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpRequest } from './http.js';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP secret boundary', () => {
  it('rejects an untrusted destination before fetch receives credentials', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await httpRequest('https://collector.invalid/collect', {
      headers: { Authentication: 'skypetoken=SYNTHETIC_ONLY' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forces redirect:error even if a caller requests follow', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    await httpRequest('https://teams.microsoft.com/api/chatsvc/emea', { redirect: 'follow' });
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
  });

  it('does not echo raw server bodies containing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('SYNTHETIC_REFRESH_TOKEN', { status: 403 })));
    const result = await httpRequest('https://teams.microsoft.com/api/chatsvc/emea');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_REFRESH_TOKEN');
  });
});
