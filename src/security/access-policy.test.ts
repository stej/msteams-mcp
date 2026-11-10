import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasReadOnlySideEffect, isReadOnly, isToolAllowed } from './access-policy.js';

afterEach(() => vi.unstubAllEnvs());

describe('read-only policy', () => {
  it('defaults to read-only when no mode is supplied', () => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', undefined);
    expect(isReadOnly()).toBe(true);
    expect(isToolAllowed('teams_search')).toBe(true);
  });

  it.each([
    'teams_send_message', 'teams_edit_message', 'teams_delete_message',
    'teams_create_group_chat', 'teams_mark_read', 'teams_download_file',
    'teams_add_reaction', 'teams_submission_action', 'future_unknown_tool',
  ])('denies writes and future tools by default: %s', name => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'readOnly');
    expect(isToolAllowed(name)).toBe(false);
  });

  it('blocks write options on otherwise readable tools', () => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'readOnly');
    expect(hasReadOnlySideEffect('teams_get_thread', { markRead: true })).toBe(true);
    expect(hasReadOnlySideEffect('teams_login', { forceNew: true })).toBe(true);
    expect(hasReadOnlySideEffect('teams_get_thread', { markRead: false })).toBe(false);
  });

  it('requires an explicit valid full-access setting', () => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'fullAccess');
    expect(isToolAllowed('teams_send_message')).toBe(true);
    expect(hasReadOnlySideEffect('teams_get_thread', { markRead: true })).toBe(false);
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'typo');
    expect(() => isToolAllowed('teams_send_message')).toThrow();
  });
});
