/**
 * Unit tests for conversation-list parsing.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../utils/http.js', () => ({ httpRequest: vi.fn() }));
vi.mock('../utils/auth-guards.js', () => ({ requireMessageAuthWithConfig: vi.fn() }));
vi.mock('./profile-api.js', () => ({ resolveNames: vi.fn() }));
vi.mock('./csa-api.js', () => ({ getMyTeamsAndChannels: vi.fn() }));

import { getConversations, parseConversation } from './chatsvc-conversations.js';
import { httpRequest } from '../utils/http.js';
import { requireMessageAuthWithConfig } from '../utils/auth-guards.js';
import { resolveNames } from './profile-api.js';
import { getMyTeamsAndChannels } from './csa-api.js';
import { ok, err } from '../types/result.js';
import { createError, ErrorCode } from '../types/errors.js';

describe('parseConversation', () => {
  it('parses a 1:1 chat with a last-message preview', () => {
    const result = parseConversation({
      id: '19:aaa_bbb@unq.gbl.spaces',
      lastMessage: {
        imdisplayname: 'Bob',
        content: '<p>Hi there</p>',
        originalarrivaltime: '2026-06-30T10:00:00Z',
      },
    });
    expect(result).toEqual({
      conversationId: '19:aaa_bbb@unq.gbl.spaces',
      topic: '',
      chatType: 'oneOnOne',
      lastMessageTime: '2026-06-30T10:00:00Z',
      lastMessageFrom: 'Bob',
      lastMessagePreview: 'Hi there',
    });
  });

  it('classifies channel, group and meeting conversation IDs', () => {
    expect(parseConversation({ id: '19:x@thread.tacv2', threadProperties: { topic: 'General' } })?.chatType).toBe('channel');
    expect(parseConversation({ id: '19:x@thread.v2' })?.chatType).toBe('group');
    expect(parseConversation({ id: '19:meeting_x@thread.v2' })?.chatType).toBe('meeting');
  });

  it('uses the channel/group topic when present', () => {
    const result = parseConversation({ id: '19:x@thread.tacv2', threadProperties: { topic: 'General' } });
    expect(result?.topic).toBe('General');
  });

  it('truncates a long preview to 120 characters with an ellipsis', () => {
    const long = 'a'.repeat(200);
    const result = parseConversation({ id: '19:x@thread.v2', lastMessage: { content: long } });
    expect(result?.lastMessagePreview.length).toBe(121); // 120 chars + ellipsis
    expect(result?.lastMessagePreview.endsWith('…')).toBe(true);
  });

  it('returns null when the conversation has no id', () => {
    expect(parseConversation({})).toBeNull();
    expect(parseConversation({ id: '' })).toBeNull();
  });

  it('falls back to composetime when originalarrivaltime is absent', () => {
    const result = parseConversation({
      id: '19:x@thread.v2',
      lastMessage: { composetime: '2026-06-30T09:00:00Z', content: 'hey' },
    });
    expect(result?.lastMessageTime).toBe('2026-06-30T09:00:00Z');
  });
});

describe('getConversations participant names', () => {
  const ownId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const otherId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const thirdId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const chatId = (first = ownId, second = otherId) => `19:${first}_${second}@unq.gbl.spaces`;

  function mockConversations(conversations: Record<string, unknown>[]) {
    vi.mocked(httpRequest).mockResolvedValue(ok({
      status: 200, headers: new Headers(), data: { conversations },
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMyTeamsAndChannels).mockResolvedValue(ok({ teams: [] }));
    vi.mocked(requireMessageAuthWithConfig).mockReturnValue(ok({
      auth: { skypeToken: 'SYNTHETIC_SKYPE', authToken: 'SYNTHETIC_AUTH', userMri: `8:orgid:${ownId}` },
      region: 'emea', baseUrl: 'https://teams.microsoft.com',
    }));
    vi.mocked(resolveNames).mockResolvedValue(new Map([
      [`8:orgid:${otherId}`, 'Alice Example'],
      [`8:orgid:${thirdId}`, 'Bob Example'],
      [`8:orgid:${ownId}`, 'My own name'],
    ]));
    mockConversations([]);
  });

  it.each([
    [ownId, otherId],
    [otherId.toUpperCase(), ownId.toUpperCase()],
  ])('uses the other participant regardless of ID order or last-message author (%s, %s)', async (first, second) => {
    mockConversations([{
      id: chatId(first, second),
      lastMessage: { imdisplayname: 'My own name', content: 'My outgoing message' },
    }]);
    const result = await getConversations();
    expect(result).toMatchObject({ ok: true, value: { conversations: [{
      topic: 'Alice Example', lastMessageFrom: 'My own name', lastMessagePreview: 'My outgoing message',
    }] } });
    expect(resolveNames).toHaveBeenCalledExactlyOnceWith([`8:orgid:${otherId}`]);
    expect(httpRequest).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({ method: 'GET' }));
  });

  it('resolves all missing names in one deduplicated batch and keeps unresolved chats', async () => {
    mockConversations([
      { id: chatId() },
      { id: chatId(otherId, ownId), threadProperties: { topic: '   ' } },
      { id: chatId(ownId, thirdId) },
    ]);
    vi.mocked(resolveNames).mockResolvedValue(new Map([[`8:orgid:${otherId}`, 'Alice Example']]));
    const result = await getConversations();
    expect(result).toMatchObject({ ok: true, value: { conversations: [
      { topic: 'Alice Example' }, { topic: 'Alice Example' }, { topic: '' },
    ] } });
    expect(resolveNames).toHaveBeenCalledExactlyOnceWith([`8:orgid:${otherId}`, `8:orgid:${thirdId}`]);
  });

  it('keeps explicit topics and does not resolve groups, meetings, channels or system conversations', async () => {
    mockConversations([
      { id: chatId(), threadProperties: { topic: 'Existing title' } },
      { id: '19:group@thread.v2', threadProperties: { topic: 'Group title' } },
      { id: '19:meeting_x@thread.v2' },
      { id: '19:channel@thread.tacv2' },
      { id: '48:notifications' },
    ]);
    const result = await getConversations();
    expect(result).toMatchObject({ ok: true, value: { conversations: [
      { topic: 'Existing title' }, { topic: 'Group title' }, { topic: '' }, { topic: '' }, { topic: '' },
    ] } });
    expect(resolveNames).not.toHaveBeenCalled();
  });

  it('does not resolve chats outside the requested limit', async () => {
    mockConversations([
      { id: '19:group@thread.v2', threadProperties: { topic: 'First' } },
      { id: chatId() },
    ]);
    const result = await getConversations({ limit: 1 });
    expect(result).toMatchObject({ ok: true, value: { conversations: [{ topic: 'First' }] } });
    expect(result.ok && result.value.conversations).toHaveLength(1);
    expect(resolveNames).not.toHaveBeenCalled();
  });

  it.each([
    '19:invalid@unq.gbl.spaces',
    '19:invalid_also-invalid@unq.gbl.spaces',
    chatId(otherId, thirdId),
  ])('does not guess a name for invalid IDs or chats without the signed-in user (%s)', async id => {
    mockConversations([{ id }]);
    expect(await getConversations()).toMatchObject({ ok: true, value: { conversations: [{ topic: '' }] } });
    expect(resolveNames).not.toHaveBeenCalled();
  });

  it('does not guess the other participant when the signed-in user ID is unavailable', async () => {
    vi.mocked(requireMessageAuthWithConfig).mockReturnValue(ok({
      auth: { skypeToken: 'SYNTHETIC_SKYPE', authToken: 'SYNTHETIC_AUTH', userMri: 'unknown' },
      region: 'emea', baseUrl: 'https://teams.microsoft.com',
    }));
    mockConversations([{ id: chatId() }]);
    expect(await getConversations()).toMatchObject({ ok: true, value: { conversations: [{ topic: '' }] } });
    expect(resolveNames).not.toHaveBeenCalled();
  });

  it('keeps the conversation list when name resolution returns no profiles', async () => {
    mockConversations([{ id: chatId(), lastMessage: { content: 'Still available' } }]);
    vi.mocked(resolveNames).mockResolvedValue(new Map());
    expect(await getConversations()).toMatchObject({ ok: true, value: { conversations: [{
      topic: '', lastMessagePreview: 'Still available',
    }] } });
  });

  it.each([{}, { productThreadType: 'TeamsTeam', spaceThreadTopic: 'Example team' }])(
    'resolves the actual channel name from CSA, including a renamed default channel', async properties => {
      const conversationId = '19:legacy-default@thread.skype';
      mockConversations([{ id: conversationId, threadProperties: properties }]);
      vi.mocked(getMyTeamsAndChannels).mockResolvedValue(ok({ teams: [{
        teamId: conversationId, threadId: conversationId, teamName: 'Example team',
        channels: [{
          channelId: conversationId, channelName: 'Announcements', teamName: 'Example team',
          teamId: 'example-group-id', channelType: 'Standard', isMember: true,
        }],
      }] }));
      expect(await getConversations()).toMatchObject({ ok: true, value: { conversations: [{
        chatType: 'channel', topic: 'Announcements', teamName: 'Example team',
        channelName: 'Announcements', teamId: 'example-group-id',
      }] } });
      expect(getMyTeamsAndChannels).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps metadata-derived channel information when CSA is unavailable', async () => {
    mockConversations([{
      id: '19:legacy-channel@thread.skype',
      threadProperties: { productThreadType: 'TeamsStandardChannel', topicThreadTopic: 'Releases', spaceThreadTopic: 'Example team' },
    }]);
    vi.mocked(getMyTeamsAndChannels).mockResolvedValue(err(createError(ErrorCode.ACCESS_DENIED, 'Synthetic unavailable CSA')));
    expect(await getConversations()).toMatchObject({ ok: true, value: { conversations: [{
      chatType: 'channel', channelName: 'Releases', teamName: 'Example team',
    }] } });
  });
  it('does not look up names after a conversation-list failure', async () => {
    const failure = err(createError(ErrorCode.ACCESS_DENIED, 'Synthetic refusal'));
    vi.mocked(httpRequest).mockResolvedValue(failure);
    expect(await getConversations()).toBe(failure);
    expect(resolveNames).not.toHaveBeenCalled();
  });
});

describe('channel metadata classification', () => {
  it.each(['TeamsStandardChannel', 'TeamsPrivateChannel', 'TeamsSharedChannel'])(
    'recognises a legacy %s channel and returns its team and channel names', productThreadType => {
      expect(parseConversation({
        id: '19:legacy-channel@thread.skype',
        threadProperties: {
          productThreadType, threadType: 'topic', groupId: 'example-team-id',
          spaceThreadTopic: 'Example team', topicThreadTopic: 'Releases',
        },
      })).toMatchObject({
        chatType: 'channel', topic: 'Releases', channelName: 'Releases',
        teamName: 'Example team', teamId: 'example-team-id',
      });
    }
  );

  it('recognises the default channel from TeamsTeam metadata without guessing its channel name', () => {
    const result = parseConversation({
      id: '19:team-root@thread.skype',
      threadProperties: {
        productThreadType: 'TeamsTeam', threadType: 'space',
        spaceThreadTopic: 'Example team', groupId: 'example-team-id',
      },
    });
    expect(result).toMatchObject({ chatType: 'channel', teamName: 'Example team', teamId: 'example-team-id' });
    expect(result?.topic).toBe('');
  });

  it('preserves a legacy chat when its metadata says Chat', () => {
    expect(parseConversation({
      id: '19:legacy-chat@thread.skype', threadProperties: { productThreadType: 'Chat', topic: 'Friends' },
    })).toMatchObject({ chatType: 'chat', topic: 'Friends' });
  });
});
