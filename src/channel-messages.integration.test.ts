import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const fixture = vi.hoisted(() => ({
  conversationId: '19:example-team@thread.skype',
  ownMri: '8:orgid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  skypeToken: 'SYNTHETIC_SKYPE_SECRET', authToken: 'SYNTHETIC_AUTH_SECRET', csaToken: 'SYNTHETIC_CSA_SECRET',
}));
vi.mock('./utils/auth-guards.js', () => ({
  requireMessageAuthWithConfig: () => ({ ok: true, value: {
    auth: { skypeToken: fixture.skypeToken, authToken: fixture.authToken, userMri: fixture.ownMri },
    region: 'emea', baseUrl: 'https://teams.microsoft.com',
  } }),
  requireCsaAuth: () => ({ ok: true, value: {
    auth: { skypeToken: fixture.skypeToken, authToken: fixture.authToken, userMri: fixture.ownMri }, csaToken: fixture.csaToken,
  } }),
  getApiConfig: () => ({ region: 'emea', csaRegion: 'emea', baseUrl: 'https://teams.microsoft.com' }),
  requireSubstrateTokenAsync: async () => ({ ok: true, value: 'SYNTHETIC_SUBSTRATE_SECRET' }),
  getTenantId: () => 'example-tenant',
  getTeamsBaseUrl: () => 'https://teams.microsoft.com',
}));
import { createServer } from './server.js';

const rootId = '1794229307274';
const replyId = '1794290417473';
const properties = { productThreadType: 'TeamsTeam', threadType: 'space', spaceThreadTopic: 'Example team', groupId: 'example-group' };
const messages = [
  { id: replyId, rootMessageId: rootId, messagetype: 'RichText/Html', content: '<p>Reply</p>', originalarrivaltime: '2026-11-10T06:00:17.473Z' },
  { id: rootId, messagetype: 'RichText/Html', content: '<p>Original post</p>', originalarrivaltime: '2026-11-09T13:01:47.274Z' },
];
const teamResponse = { teams: [{
  id: fixture.conversationId, displayName: 'Example team', channels: [{
    id: fixture.conversationId, displayName: 'Announcements', groupId: 'example-group', channelType: 0,
  }],
}] };
let client: Client;
let server: Awaited<ReturnType<typeof createServer>>;
let refuseCsa = false;
let scopedSearchThread = false;
let omitCsaGroup = false;
let metadataProperties: Record<string, unknown> = properties;
let activityThreadReference = false;
let activitySystemClump = false;
let refuseSourceMessage = false;
let refuseConversationMetadata = false;
const requests: Array<{ path: string; method: string; redirect?: RequestRedirect }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  vi.stubEnv('MSTEAMS_ACCESS_MODE', 'readOnly');
  requests.length = 0;
  refuseCsa = false;
  scopedSearchThread = false;
  omitCsaGroup = false;
  metadataProperties = properties;
  activityThreadReference = false;
  activitySystemClump = false;
  refuseSourceMessage = false;
  refuseConversationMetadata = false;
  fixture.conversationId = '19:example-team@thread.skype';
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    requests.push({ path, method: options?.method ?? 'GET', redirect: options?.redirect });
    if (url.hostname === 'substrate.office.com') return json({ EntitySets: [{ ResultSets: [{ Total: 1, Results: [{
      Id: 'example-search-result', HitHighlightedSummary: 'A reply in a channel thread',
      Source: {
        ClientThreadId: fixture.conversationId + (scopedSearchThread ? `;messageid=${rootId}` : ''),
        ClientConversationId: `${fixture.conversationId};messageid=${rootId}`,
        DateTimeReceived: '2026-11-10T06:00:17.473Z',
      },
    }] }] }] });
    if (path.endsWith('/teams/users/me')) {
      const response = structuredClone(teamResponse);
      if (omitCsaGroup) response.teams[0].channels[0].groupId = '';
      return refuseCsa ? json({}, 403) : json(response);
    }
    if (path.endsWith('/conversations')) return json({ conversations: [{ id: fixture.conversationId, threadProperties: properties, lastMessage: messages[0] }] });
    if (path.endsWith(`/messages/${replyId}`)) return refuseSourceMessage ? json({}, 403) : json(messages[0]);
    if (path.includes('/48:saved/messages')) return json({ messages: [{
      id: '1794290888888', messagetype: 'RichText/Html', content: '<p>Reply</p>', originalarrivaltime: messages[0].originalarrivaltime,
      clumpId: fixture.conversationId, secondaryReferenceId: `T_${fixture.conversationId}_M_${replyId}`,
    }] });
    if (path.includes('/48:threads/messages')) return json({ messages: [{
      ...messages[1], clumpId: fixture.conversationId, secondaryReferenceId: `T_${fixture.conversationId}_P_${rootId}_Threads`,
    }] });
    if (path.includes('/48:notifications/messages')) return json({ messages: [{
      id: '1794290999999', messagetype: 'RichText/Html', content: '<p>Reply</p>', originalarrivaltime: messages[0].originalarrivaltime, conversationid: '48:notifications',
      clumpId: activitySystemClump ? 'nr:system:clump:Mentions' : fixture.conversationId,
      secondaryReferenceId: activityThreadReference ? `T_${fixture.conversationId}_P_${rootId}_Threads` : `T_${fixture.conversationId}_M_${replyId}`,
    }] });
    if (path.endsWith('/messages')) return json({ messages });
    if (path.endsWith(`/conversations/${fixture.conversationId}`)) return refuseConversationMetadata ? json({}, 403) : json({ id: fixture.conversationId, threadProperties: metadataProperties });
    return json({}, 404);
  }));
  server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'channel-contract-test', version: '1.0.0' });
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult;
  const content = result.content.find(part => part.type === 'text');
  if (!content || content.type !== 'text') throw new Error('Missing tool payload');
  return JSON.parse(content.text);
}

function assertChannelLink(link: string, messageId: string, parentMessageId: string) {
  const url = new URL(link);
  expect(decodeURIComponent(url.pathname)).toBe(`/l/message/${fixture.conversationId}/${messageId}`);
  expect(url.searchParams.get('context')).toBeNull();
  expect(url.searchParams.get('groupId')).toBe('example-group');
  expect(url.searchParams.get('tenantId')).toBe('example-tenant');
  expect(url.searchParams.get('parentMessageId')).toBe(parentMessageId);
  expect(url.searchParams.get('teamName')).toBe('Example team');
  expect(url.searchParams.get('channelName')).toBe('Announcements');
}

describe('channel metadata over the registered read-only MCP handlers and HTTP client', () => {
  it('returns channel location in the chat list through the actual protocol', async () => {
    const result = await call('teams_list_chats', { limit: 10 });
    expect(result).toMatchObject({ success: true, conversations: [{
      chatType: 'channel', topic: 'Announcements', teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group',
    }] });
    expect(requests.every(request => request.method === 'GET' && request.redirect === 'error')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_');
  });

  it('returns team/channel names and distinct links for the post and reply', async () => {
    const result = await call('teams_get_thread', { conversationId: fixture.conversationId, limit: 3, markRead: false });
    expect(result).toMatchObject({ success: true, teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group' });
    for (const message of result.messages) expect(message).toMatchObject({ teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group' });
    assertChannelLink(result.messages.find((message: { id: string }) => message.id === replyId).messageLink, replyId, rootId);
    assertChannelLink(result.messages.find((message: { id: string }) => message.id === rootId).messageLink, rootId, rootId);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });

  it('returns the same location and reply link for a single-message read', async () => {
    const result = await call('teams_get_message', { conversationId: fixture.conversationId, messageId: replyId });
    expect(result).toMatchObject({ success: true, teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group', threadRootId: rootId });
    assertChannelLink(result.messageLink, replyId, rootId);
  });

  it('reads only the requested thread when given its generated reply link', async () => {
    const first = await call('teams_get_thread', { conversationId: fixture.conversationId, limit: 3, markRead: false });
    const link = first.messages.find((message: { id: string }) => message.id === replyId).messageLink;
    requests.length = 0;
    expect(await call('teams_get_thread', { fromUrl: link, limit: 3, markRead: false })).toMatchObject({ success: true });
    expect(requests.some(request => request.path.includes(`;messageid=${rootId}/messages`))).toBe(true);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });

  it('keeps the message readable and uses channel metadata when the optional CSA lookup fails', async () => {
    refuseCsa = true;
    const result = await call('teams_get_message', { conversationId: fixture.conversationId, messageId: replyId });
    expect(result).toMatchObject({ success: true, content: 'Reply', teamName: 'Example team', teamId: 'example-group' });
    expect(result.channelName).toBeUndefined();
    const url = new URL(result.messageLink);
    expect(url.searchParams.get('context')).toBeNull();
    expect(url.searchParams.get('groupId')).toBe('example-group');
    expect(url.searchParams.get('parentMessageId')).toBe(rootId);
  });

  it.each([false, true])('returns the channel location and correct parent in search results (scoped ID: %s)', async scoped => {
    scopedSearchThread = scoped;
    const result = await call('teams_search', { query: 'Example reply', maxResults: 1, size: 1 });
    expect(result).toMatchObject({ success: true, resultCount: 1, results: [{
      conversationId: fixture.conversationId, teamName: 'Example team', channelName: 'Announcements',
      teamId: 'example-group', threadRootId: rootId,
    }] });
    assertChannelLink(result.results[0].messageLink, replyId, rootId);
  });
  it.each([
    ['teams_get_saved_messages', 'messages', 'messageLink', replyId, rootId],
    ['teams_get_followed_threads', 'threads', 'messageLink', rootId, rootId],
    ['teams_get_activity', 'activities', 'activityLink', replyId, rootId],
  ])('uses channel location in referenced messages returned by %s', async (tool, collection, linkField, messageId, parentId) => {
    const result = await call(tool, { limit: 3 });
    expect(result.success).toBe(true);
    const item = result[collection][0];
    expect(item).toMatchObject({ teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group' });
    assertChannelLink(item[linkField], messageId, parentId);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('preserves the verified group ID when CSA omits it from a channel', async () => {
    omitCsaGroup = true;
    expect(await call('teams_list_chats', { limit: 10 })).toMatchObject({ success: true, conversations: [{
      teamName: 'Example team', channelName: 'Announcements', teamId: 'example-group',
    }] });
  });

  it('recognises legacy channel threadType metadata when CSA and productThreadType are unavailable', async () => {
    refuseCsa = true;
    metadataProperties = { threadType: 'topic', spaceThreadTopic: 'Example team', topicThreadTopic: 'Announcements' };
    const result = await call('teams_get_message', { conversationId: fixture.conversationId, messageId: replyId });
    expect(result).toMatchObject({ success: true, teamName: 'Example team', channelName: 'Announcements' });
    const url = new URL(result.messageLink);
    expect(url.searchParams.get('context')).toBeNull();
    expect(url.searchParams.get('parentMessageId')).toBe(rootId);
  });
  it.each([
    ['teams_search', 'results', 'messageLink'],
    ['teams_get_saved_messages', 'messages', 'messageLink'],
    ['teams_get_followed_threads', 'threads', 'messageLink'],
    ['teams_get_activity', 'activities', 'activityLink'],
  ])('R2: keeps channel links when CSA is unavailable in %s', async (tool, collection, linkField) => {
    refuseCsa = true;
    const result = await call(tool, tool === 'teams_search' ? { query: 'Example reply', size: 1 } : { limit: 3 });
    expect(result.success).toBe(true);
    const item = result[collection][0];
    expect(item).toMatchObject({ teamName: 'Example team', teamId: 'example-group' });
    const url = new URL(item[linkField]);
    expect(url.searchParams.get('context')).toBeNull();
    expect(url.searchParams.get('groupId')).toBe('example-group');
    expect(url.searchParams.has('parentMessageId')).toBe(true);
  });
  it.each([[false, false], [false, true], [true, true]])(
    'R1: resolves activity references independently of virtual IDs and clumps (thread: %s, system clump: %s)', async (thread, systemClump) => {
      activityThreadReference = thread;
      activitySystemClump = systemClump;
      const result = await call('teams_get_activity', { limit: 3 });
      const activity = result.activities[0];
      const sourceId = thread ? rootId : replyId;
      expect(activity).toMatchObject({ id: '1794290999999', conversationId: fixture.conversationId, sourceMessageId: sourceId });
      assertChannelLink(activity.activityLink, sourceId, rootId);
    }
  );
  it.each([
    ['teams_get_saved_messages', 'messages', 'messageLink'],
    ['teams_get_activity', 'activities', 'activityLink'],
  ])('R3: resolves the actual parent from the original reply for %s', async (tool, collection, linkField) => {
    const result = await call(tool, { limit: 3 });
    assertChannelLink(result[collection][0][linkField], replyId, rootId);
    expect(requests.filter(request => request.path.endsWith(`/messages/${replyId}`))).toHaveLength(1);
  });

  it.each([
    ['teams_get_saved_messages', 'messages', 'messageLink'],
    ['teams_get_activity', 'activities', 'activityLink'],
  ])('R3: preserves content without inventing a thread link when the source reply is unavailable in %s', async (tool, collection, linkField) => {
    refuseSourceMessage = true;
    const result = await call(tool, { limit: 3 });
    expect(result.success).toBe(true);
    expect(result[collection][0].content).toBe('Reply');
    expect(result[collection][0][linkField]).toBeUndefined();
  });
  it.each([
    ['teams_get_saved_messages', 'messages', 'messageLink', '19:legacy@thread.skype'],
    ['teams_get_saved_messages', 'messages', 'messageLink', '19:modern@thread.tacv2'],
    ['teams_get_activity', 'activities', 'activityLink', '19:legacy@thread.skype'],
    ['teams_get_activity', 'activities', 'activityLink', '19:modern@thread.tacv2'],
    ['teams_search', 'results', 'messageLink', '19:legacy@thread.skype'],
  ])('R4: preserves data without an unverified link when both metadata sources fail in %s (%s, %s, %s)', async (tool, collection, linkField, conversationId) => {
    fixture.conversationId = conversationId;
    refuseCsa = true;
    refuseConversationMetadata = true;
    const result = await call(tool, tool === 'teams_search' ? { query: 'Example reply', size: 1 } : { limit: 3 });
    expect(result.success).toBe(true);
    expect(result[collection]).toHaveLength(1);
    expect(result[collection][0].content).toBeTruthy();
    expect(result[collection][0][linkField]).toBeUndefined();
  });

  it('R4: preserves valid chat links for a legacy conversation verified as Chat', async () => {
    refuseCsa = true;
    metadataProperties = { productThreadType: 'Chat', threadType: 'chat', topic: 'Friends' };
    const result = await call('teams_get_saved_messages', { limit: 3 });
    const url = new URL(result.messages[0].messageLink);
    expect(url.searchParams.get('context')).toBe('{"contextType":"chat"}');
    expect(url.searchParams.get('groupId')).toBeNull();
  });
  it('still blocks markRead:true and send tools before any network access', async () => {
    expect(await call('teams_get_thread', { conversationId: fixture.conversationId, markRead: true })).toMatchObject({ success: false, errorCode: 'ACCESS_DENIED' });
    expect(await call('teams_send_message', { conversationId: fixture.conversationId, content: 'Must not send' })).toMatchObject({ success: false, errorCode: 'ACCESS_DENIED' });
    expect(requests).toHaveLength(0);
  });
});
