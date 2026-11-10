import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./csa-api.js', () => ({ getMyTeamsAndChannels: vi.fn() }));
import { getMyTeamsAndChannels } from './csa-api.js';
import { loadChannelContexts } from './channel-context.js';
vi.mock('../utils/auth-guards.js', () => ({ requireMessageAuthWithConfig: () => ({ ok: true, value: {
  auth: { skypeToken: 'SYNTHETIC', authToken: 'SYNTHETIC', userMri: 'synthetic-user' }, region: 'emea', baseUrl: 'https://teams.microsoft.com',
} }) }));
vi.mock('../utils/http.js', () => ({ httpRequest: vi.fn() }));
import { httpRequest } from '../utils/http.js';
import { ok, err } from '../types/result.js';
import { createError, ErrorCode } from '../types/errors.js';

type TeamsResponse = Awaited<ReturnType<typeof getMyTeamsAndChannels>>;
function deferred() {
  let complete!: (value: TeamsResponse) => void;
  const promise = new Promise<TeamsResponse>(resolve => { complete = resolve; });
  return { promise, complete: (value: TeamsResponse) => complete(value) };
}
function team(id: string, name: string): TeamsResponse {
  return ok({ teams: [{ teamId: id, threadId: id, teamName: name, channels: [{
    channelId: id, channelName: 'General', teamName: name, teamId: `${name}-group`, channelType: 'Standard',
  }] }] });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(httpRequest).mockResolvedValue(err(createError(ErrorCode.ACCESS_DENIED, 'Synthetic metadata refusal')));
});

describe('per-request channel metadata', () => {
  it('does not require a CSA lookup for personal, group or meeting chats', async () => {
    expect(await loadChannelContexts(['19:a_b@unq.gbl.spaces', '19:group@thread.v2', '19:meeting_x@thread.v2'])).toEqual(new Map());
    expect(getMyTeamsAndChannels).not.toHaveBeenCalled();
  });

  it('returns no enrichment when CSA refuses access or fails', async () => {
    vi.mocked(getMyTeamsAndChannels).mockResolvedValueOnce(err(createError(ErrorCode.ACCESS_DENIED, 'Synthetic refusal'))).mockRejectedValueOnce(new Error('Synthetic transport failure'));
    expect(await loadChannelContexts(['19:a@thread.skype'])).toEqual(new Map());
    expect(await loadChannelContexts(['19:a@thread.skype'])).toEqual(new Map());
  });

  it('keeps independent request metadata isolated when responses complete in the opposite order', async () => {
    const first = deferred();
    const second = deferred();
    const id = '19:same-id@thread.skype';
    vi.mocked(getMyTeamsAndChannels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const requestA = loadChannelContexts([id]);
    const requestB = loadChannelContexts([id]);
    second.complete(team(id, 'Tenant B team'));
    expect((await requestB).get(id)?.teamName).toBe('Tenant B team');
    first.complete(team(id, 'Tenant A team'));
    expect((await requestA).get(id)?.teamName).toBe('Tenant A team');
  });
});
