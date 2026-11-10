import { describe, expect, it } from 'vitest';
import { isAllowedApiUrl, isTeamsUrl, isTranscriptUrl } from './network-policy.js';

describe('credential destinations', () => {
  it.each([
    'https://teams.microsoft.com/api/chatsvc/emea',
    'https://teams.cloud.microsoft/api/chatsvc/emea',
    'https://substrate.office.com/searchservice/api/v2/query',
    'https://graph.microsoft.com/v1.0/drives/id/items/id',
  ])('accepts a known API destination: %s', value => {
    expect(isAllowedApiUrl(value)).toBe(true);
  });

  it.each([
    'https://collector.invalid/token',
    'http://teams.microsoft.com/api/chatsvc/emea',
    'https://teams.microsoft.com.collector.invalid/api/chatsvc/emea',
    'https://collector.invalid/?next=https://teams.microsoft.com',
    'https://user:password@teams.microsoft.com/api/chatsvc/emea',
    'https://teams.microsoft.com:8443/api/chatsvc/emea',
  ])('rejects untrusted destinations: %s', value => {
    expect(isAllowedApiUrl(value)).toBe(false);
    expect(isTeamsUrl(value)).toBe(false);
  });

  it('only permits transcript credentials at the media transcript endpoint', () => {
    expect(isTranscriptUrl('https://emea.asyncgw.teams.microsoft.com/v1/objects/example/content/amsTranscript')).toBe(true);
    expect(isTranscriptUrl('https://collector.invalid/v1/objects/example/content/amsTranscript')).toBe(false);
    expect(isTranscriptUrl('https://emea.asyncgw.teams.microsoft.com/v1/objects/example/content/image')).toBe(false);
    expect(isTranscriptUrl('https://asyncgw.teams.microsoft.com.collector.invalid/v1/objects/id/content/amsTranscript')).toBe(false);
  });
});
