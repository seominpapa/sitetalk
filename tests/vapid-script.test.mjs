import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('VAPID provisioning keeps keys private and refuses accidental rotation', () => {
  const cwd=mkdtempSync(join(tmpdir(),'site-talk-vapid-'));
  const script=fileURLToPath(new URL('../scripts/vapid.mjs',import.meta.url));
  try {
    const first=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});
    assert.equal(first.status,0);
    const path=join(cwd,'.wrangler/vapid.env');
    const saved=readFileSync(path,'utf8');
    const vars=Object.fromEntries(saved.trim().split('\n').map(line=>line.split('=')));
    assert.equal(Buffer.from(vars.VAPID_PUBLIC_KEY,'base64url').length,65);
    assert.equal(Buffer.from(vars.VAPID_PRIVATE_KEY,'base64url').length,32);
    assert.equal(statSync(path).mode & 0o777,0o600);
    assert.ok(!first.stdout.includes(vars.VAPID_PRIVATE_KEY));
    const second=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});
    assert.notEqual(second.status,0);
    assert.ok(readFileSync(path,'utf8')===saved);
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});
