import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { assertLocalPath, secureDirectory } from './windows-protection.js';

let testRoot: string | undefined;
afterEach(async () => {
  if (!testRoot) return;
  // Cleanup is confined to the temporary directory created by this test.
  if (dirname(resolve(testRoot)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path.');
  await rm(testRoot, { recursive: true, force: true });
  testRoot = undefined;
});

describe.runIf(process.platform === 'win32')('Windows local storage checks', () => {
  it('creates a protected local directory without touching the account cache', async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'msteams-security-'));
    const target = join(testRoot, 'protected');
    secureDirectory(target);
    await writeFile(join(target, 'synthetic.txt'), 'SYNTHETIC_ONLY');
  });

  it('rejects a UNC path before opening it', () => {
    expect(() => assertLocalPath('\\\\collector.invalid\\share\\file')).toThrow();
  });

  it('rejects a child path reached through a junction', async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'msteams-security-'));
    const target = join(testRoot, 'local-target');
    const junction = join(testRoot, 'junction');
    await mkdir(target);
    await symlink(target, junction, 'junction');
    expect(() => assertLocalPath(join(junction, 'child.txt'))).toThrow();
  });
});
