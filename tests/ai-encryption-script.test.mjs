import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('AI encryption provisioning generates a private random key and refuses rotation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'site-talk-key-'));
  const script = fileURLToPath(new URL('../scripts/ai-encryption-key.mjs', import.meta.url));
  try {
    const first = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    assert.equal(first.status, 0);
    const path = join(cwd, '.wrangler/secrets/ai-settings-encryption.key');
    const key = (await readFile(path, 'utf8')).trim();
    assert.equal(Buffer.from(key, 'base64').length, 32);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(cwd, '.wrangler/secrets'))).mode & 0o777, 0o700);
    assert.ok(!first.stdout.includes(key) && !first.stderr.includes(key));
    const second = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.equal((await readFile(path, 'utf8')).trim(), key);
    assert.ok(!second.stdout.includes(key) && !second.stderr.includes(key));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
