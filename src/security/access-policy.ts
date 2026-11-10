/** Explicit allowlist: future tools are denied by default in read-only mode. */
const READ_TOOLS = new Set([
  'teams_search', 'teams_search_email', 'teams_get_thread', 'teams_find_channel',
  'teams_get_favorites', 'teams_get_chat', 'teams_get_unread', 'teams_get_activity',
  'teams_search_emoji', 'teams_get_saved_messages', 'teams_get_followed_threads',
  'teams_get_message', 'teams_list_chats', 'teams_wait_for_reply', 'teams_get_me',
  'teams_search_people', 'teams_get_frequent_contacts', 'teams_get_person',
  'teams_status', 'teams_login', 'teams_get_meetings', 'teams_get_transcript',
  'teams_get_shared_files', 'teams_get_tags', 'teams_list_assignments', 'teams_get_assignment',
]);

export function isReadOnly(): boolean {
  const mode = process.env.MSTEAMS_ACCESS_MODE ?? 'readOnly';
  if (mode !== 'readOnly' && mode !== 'fullAccess') {
    throw new Error('MSTEAMS_ACCESS_MODE must be readOnly or fullAccess.');
  }
  return mode === 'readOnly';
}

export function isToolAllowed(name: string): boolean {
  return !isReadOnly() || READ_TOOLS.has(name);
}

/** Auth setup may save local credentials; resetting them requires full access. */
export function hasReadOnlySideEffect(name: string, args: unknown): boolean {
  if (!isReadOnly() || !args || typeof args !== 'object') return false;
  const input = args as Record<string, unknown>;
  return name === 'teams_get_thread' && input.markRead === true
    || name === 'teams_login' && input.forceNew === true;
}
