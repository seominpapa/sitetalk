// Local test fixture only. Never writes to a remote database.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { passwordHash } from '../apps/worker/src/crypto.ts';
await mkdir('.wrangler', { recursive: true });
const suffix = randomBytes(5).toString('hex');
const siteId = randomUUID();
const users = await Promise.all(['김대리', '박과장', '외부사용자'].map(async (name, index) => {
  const password = randomBytes(24).toString('base64url');
  return { id: randomUUID(), site_id: siteId, email: `test-${suffix}-${index}@example.invalid`, name, role: index === 0 ? 'admin' : 'member', password, password_hash: await passwordHash(password) };
}));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const sql = [
  ...users.map(u => `INSERT INTO users(id,name,email,role,password_hash,company,department,created_at) VALUES(${[u.id,u.name,u.email,u.role,u.password_hash,'Site Talk 테스트','시공팀',Date.now()].map(quote).join(',')});`),
  `INSERT INTO sites(id,name,created_by,created_at) VALUES(${[siteId,`테스트 현장 ${suffix}`,users[0].id,Date.now()].map(quote).join(',')});`,
  ...users.map(u => `INSERT INTO site_memberships(site_id,user_id,role,status,created_at,updated_at) VALUES(${[siteId,u.id,'member','approved',Date.now(),Date.now()].map(quote).join(',')});`),
].join('\n');
await writeFile('.wrangler/test-users.sql', sql, { mode: 0o600 });
execFileSync('npx', ['wrangler', 'd1', 'execute', 'site-talk', '--local', '--file=.wrangler/test-users.sql'], { stdio: 'pipe' });
await writeFile('.wrangler/test-users.json', JSON.stringify(users.map(({password_hash,...user})=>user),null,2), { mode: 0o600 });
console.log('Created 3 local test users; credentials saved only in ignored .wrangler/test-users.json');
