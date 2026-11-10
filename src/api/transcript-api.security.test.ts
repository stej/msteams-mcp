import { describe, expect, it, vi } from 'vitest';
vi.mock('../utils/http.js', () => ({ httpRequest: vi.fn() }));
vi.mock('../utils/auth-guards.js', () => ({
  requireSubstrateTokenAsync: vi.fn().mockResolvedValue({ ok: true, value: 'SYNTHETIC_SUBSTRATE' }),
  requireMessageAuth: vi.fn().mockReturnValue({ ok: true, value: { skypeToken: 'SYNTHETIC_SKYPE' } }),
}));
vi.mock('./chatsvc-messaging.js', () => ({ getThreadMessages: vi.fn() }));

import { httpRequest } from '../utils/http.js';
import { getThreadMessages } from './chatsvc-messaging.js';
import { getTranscriptContent } from './transcript-api.js';

describe('untrusted transcript links', () => {
  it('does not send the Skype token to a link supplied by chat content', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true, value: { status: 200, headers: new Headers(), data: { value: [] } },
    });
    vi.mocked(getThreadMessages).mockResolvedValue({
      ok: true,
      value: {
        conversationId: 'synthetic-thread',
        messages: [{
          id: '1', content: 'recording', contentType: 'Text', timestamp: '',
          conversationId: 'synthetic-thread', sender: { mri: 'synthetic-sender' },
          isFromMe: false,
          links: [{ contentType: 'amsTranscript', text: 'amsTranscript', url: 'https://collector.invalid/collect' }],
        }],
      },
    });
    const result = await getTranscriptContent('synthetic-thread');
    expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(httpRequest).mock.calls[0][0]).toContain('substrate.office.com');
  });
});
