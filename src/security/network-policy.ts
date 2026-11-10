import { TEAMS_HOSTS } from '../constants.js';

/** Reject credentials, nonstandard ports, fragments and unencrypted transport. */
export function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      ? url : null;
  } catch {
    return null;
  }
}

export function isTeamsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && TEAMS_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** Only the Teams asynchronous media service may receive a transcript token. */
export function isTranscriptUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  return url !== null
    && (url.hostname === 'asyncgw.teams.microsoft.com' || url.hostname.endsWith('.asyncgw.teams.microsoft.com'))
    && /^\/v1\/objects\/[^/]+\/content\/amsTranscript\/?$/.test(url.pathname);
}

const API_HOSTS = new Set([
  ...TEAMS_HOSTS,
  'substrate.office.com',
  'graph.microsoft.com',
  'assignments.edu.cloud.microsoft',
]);

export function isAllowedApiUrl(value: string): boolean {
  const url = parseHttpsUrl(value);
  return url !== null && (API_HOSTS.has(url.hostname) || isTranscriptUrl(value));
}

/** Exact cookie domains used by Teams, including its messaging service. */
export function isTeamsCookieDomain(value: string | undefined): boolean {
  const host = (value ?? '').replace(/^\./, '');
  return TEAMS_HOSTS.includes(host) || host === 'asm.skype.com'
    || host === 'asyncgw.teams.microsoft.com' || host.endsWith('.asyncgw.teams.microsoft.com');
}
