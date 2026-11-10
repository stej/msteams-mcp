import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Operation = 'Protect' | 'Unprotect' | 'SecureDirectory' | 'AssertLocalPath';

/** Fixed executable locations avoid resolving a credential helper through PATH. */
export function windowsProtection(operation: Operation, value: Buffer): Buffer {
  if (process.platform !== 'win32') {
    throw new Error('This hardened local copy requires Windows DPAPI.');
  }
  const executable = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\pwsh\\pwsh.exe',
  ].find(existsSync);
  if (!executable) throw new Error('PowerShell 7 is required for Windows credential protection.');

  const helper = fileURLToPath(new URL('../../scripts/windows-protection.ps1', import.meta.url));
  try {
    const output = execFileSync(executable, [
      '--noprofile', '-NonInteractive', '-File', helper, '-Operation', operation,
    ], {
      // Secrets and paths travel only through stdin, never command-line arguments.
      input: value.toString('base64'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return Buffer.from(output.trim(), 'base64');
  } catch {
    // Never expose helper stdout, stderr or input through MCP errors or logs.
    throw new Error('Windows credential or local-path protection failed.');
  }
}

export function secureDirectory(directory: string): void {
  windowsProtection('SecureDirectory', Buffer.from(directory, 'utf8'));
}

/** Validate every existing component, including the file, before filesystem access. */
export function assertLocalPath(filePath: string): void {
  windowsProtection('AssertLocalPath', Buffer.from(filePath, 'utf8'));
}
