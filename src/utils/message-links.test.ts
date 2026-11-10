import { describe, expect, it } from 'vitest';
import { buildMessageLink, parseTeamsMessageUrl } from './parsers-identifiers.js';

const channel = { teamId: 'example-group', teamName: 'Fiktivní tým Orion & R&D', channelName: 'General / Obecné' };

describe('documented channel message links', () => {
  it.each(['19:legacy@thread.skype', '19:modern@thread.tacv2'])(
    'builds a top-level channel post link with its location (%s)', conversationId => {
      const url = new URL(buildMessageLink({ conversationId, messageId: '1000', tenantId: 'example-tenant', channel }));
      expect(url.searchParams.get('context')).toBeNull();
      expect(url.searchParams.get('groupId')).toBe(channel.teamId);
      expect(url.searchParams.get('teamName')).toBe(channel.teamName);
      expect(url.searchParams.get('channelName')).toBe(channel.channelName);
      expect(url.searchParams.get('tenantId')).toBe('example-tenant');
      expect(url.searchParams.get('parentMessageId')).toBe('1000');
      expect(url.searchParams.get('createdTime')).toBe('1000');
    }
  );

  it.each(['19:legacy@thread.skype', '19:modern@thread.tacv2'])(
    'links to the actual reply while preserving the parent thread (%s)', conversationId => {
      const link = buildMessageLink({ conversationId, messageId: '2000', parentMessageId: '1000', channel });
      const url = new URL(link);
      expect(decodeURIComponent(url.pathname)).toBe(`/l/message/${conversationId}/2000`);
      expect(url.searchParams.get('context')).toBeNull();
      expect(url.searchParams.get('parentMessageId')).toBe('1000');
      expect(url.searchParams.get('createdTime')).toBe('2000');
      expect(parseTeamsMessageUrl(link)).toEqual({ conversationId, messageId: '2000', threadRootId: '1000' });
    }
  );

  it('recognises an explicitly supplied channel group ID for legacy links', () => {
    const url = new URL(buildMessageLink({ conversationId: '19:legacy@thread.skype', messageId: '2000', groupId: 'example-group' }));
    expect(url.searchParams.get('groupId')).toBe('example-group');
    expect(url.searchParams.get('parentMessageId')).toBe('2000');
    expect(url.searchParams.get('context')).toBeNull();
  });
});
