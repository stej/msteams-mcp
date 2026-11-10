import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { CONFIG_DIR, ensureConfigDir } from '../auth/session-store.js';
import { secureDirectory } from './windows-protection.js';

export const DOWNLOAD_DIR = join(CONFIG_DIR, 'downloads');

/** Only one ordinary file directly inside the protected local directory. */
export function resolveDownloadPath(value: string): string {
  if (!isAbsolute(value) || !/^[A-Za-z]:[\\/]/.test(value)
    // Control characters are intentionally forbidden in Windows filenames.
    // eslint-disable-next-line no-control-regex
    || /[<>:"|?*\x00-\x1f]/.test(value.slice(2))
    || value.split(/[\\/]/).some(part => /[. ]$/.test(part))) {
    throw new Error('Downloads require an ordinary local-drive file path.');
  }
  const target = resolve(value);
  const root = resolve(DOWNLOAD_DIR);
  const child = relative(root, target);
  if (!child || child.startsWith('..') || isAbsolute(child) || dirname(target) !== root
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(win32.basename(target))) {
    throw new Error('Downloads must be saved directly inside the protected downloads directory.');
  }
  return target;
}

export function prepareDownloadDirectory(): void {
  ensureConfigDir();
  // Reject network drives/reparse points, then apply Windows ACLs.
  secureDirectory(DOWNLOAD_DIR);
}
