/** Per-request channel lookup. No cross-account or long-lived metadata cache. */
import { getMyTeamsAndChannels } from './csa-api.js';
import type { ChannelContext } from '../types/teams.js';
import type { RawConversationResponse, RawChatsvcMessage } from '../types/api-responses.js';
import { getConversationType, messageReferenceKey, type MessageReference } from '../utils/parsers-identifiers.js';
import { requireMessageAuthWithConfig } from '../utils/auth-guards.js';
import { CHATSVC_API, getSkypeAuthHeaders } from '../utils/api-config.js';
import { httpRequest } from '../utils/http.js';

export async function loadChannelContexts(conversationIds: string[]): Promise<Map<string, ChannelContext>> {
  const ids = new Set(conversationIds.filter(id => /@thread\.(skype|tacv2)$/.test(id)));
  const channels = new Map<string, ChannelContext>();
  if (ids.size === 0) return channels;
  try {
    const result = await getMyTeamsAndChannels();
    if (result.ok) {
      for (const team of result.value.teams) {
        for (const channel of team.channels) {
          if (ids.has(channel.channelId)) channels.set(channel.channelId, {
            conversationType: 'channel',
            teamId: channel.teamId || undefined,
            teamName: channel.teamName,
            channelName: channel.channelName,
          });
        }
      }
    }
  } catch {
    // Metadata below can still identify channels when the optional CSA lookup fails.
  }
  const missing = [...ids].filter(id => {
    const channel = channels.get(id);
    return !channel?.teamId || !channel.teamName || !channel.channelName;
  });
  if (missing.length === 0) return channels;
  const session = requireMessageAuthWithConfig();
  if (!session.ok) return channels;
  const { auth, region, baseUrl } = session.value;
  await Promise.all(missing.map(async id => {
    try {
      const result = await httpRequest<RawConversationResponse>(CHATSVC_API.conversation(region, id, baseUrl) + '?view=msnp24Equivalent', {
        method: 'GET', headers: getSkypeAuthHeaders(auth.skypeToken, auth.authToken, baseUrl),
      });
      if (!result.ok) return;
      const properties = result.value.data.threadProperties;
      const type = getConversationType(id, properties);
      if (type !== 'channel') {
        if (properties?.productThreadType === 'Chat' || properties?.productThreadType === 'OneOnOne'
          || properties?.productThreadType === 'Meeting' || properties?.threadType === 'chat' || properties?.threadType === 'meeting') {
          channels.set(id, { conversationType: type });
        }
        return;
      }
      const channel = channels.get(id);
      channels.set(id, {
        conversationType: 'channel',
        teamId: channel?.teamId ?? (typeof properties?.groupId === 'string' ? properties.groupId : undefined),
        teamName: channel?.teamName ?? (typeof properties?.spaceThreadTopic === 'string' ? properties.spaceThreadTopic : undefined),
        channelName: channel?.channelName ?? (typeof properties?.topicThreadTopic === 'string' ? properties.topicThreadTopic
          : typeof properties?.topic === 'string' ? properties.topic : undefined),
      });
    } catch {
      // Enrichment failure must not discard the successfully retrieved messages.
    }
  }));
  return channels;
}

/** Virtual stubs omit the parent thread: read the source message before linking it. */
export async function loadChannelMessageRoots(
  references: MessageReference[],
  channels: ReadonlyMap<string, ChannelContext>
): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  const unique = new Map(references.filter(reference => reference.kind === 'message' && channels.get(reference.conversationId)?.conversationType === 'channel')
    .map(reference => [messageReferenceKey(reference), reference]));
  if (unique.size === 0) return roots;
  const session = requireMessageAuthWithConfig();
  if (!session.ok) return roots;
  const { auth, region, baseUrl } = session.value;
  await Promise.all([...unique].map(async ([key, reference]) => {
    try {
      const result = await httpRequest<RawChatsvcMessage>(CHATSVC_API.singleMessage(region, reference.conversationId, reference.messageId, baseUrl), {
        method: 'GET', headers: getSkypeAuthHeaders(auth.skypeToken, auth.authToken, baseUrl),
      });
      if (!result.ok || result.value.data.id !== reference.messageId) return;
      const rootId = result.value.data.rootMessageId ?? reference.messageId;
      if (typeof rootId === 'string' && /^\d+$/.test(rootId)) roots.set(key, rootId);
    } catch {
      // An unresolved source must not turn into a fabricated thread link.
    }
  }));
  return roots;
}
