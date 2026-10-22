import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('Docker runtime is pinned, non-root and ships the complete app without development dependencies', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /FROM node:24\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64} AS build/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  for (const path of ['apps/server', 'apps/worker/src', 'packages/shared', 'database/migrations', 'dist', 'LICENSE']) assert.ok(dockerfile.includes(path), `Missing runtime path: ${path}`);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "apps\/server\/main\.mjs"\]/);
});

test('Compose keeps persistent data and secrets separate from the read-only image and binds only loopback by default', () => {
  const compose = read('compose.yaml');
  assert.match(compose, /127\.0\.0\.1:\$\{SITE_TALK_PORT:-3000\}:3000/);
  assert.match(compose, /env_file:\s*\n\s*- \.env\.docker/);
  assert.match(compose, /site-talk-data:\/data/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /init: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /\/api\/health/);
  assert.match(read('.env.docker.example'), /^PUBLIC_ORIGIN=http:\/\/localhost:3000$/m);
  assert.match(read('.env.docker.example'), /^AI_SETTINGS_ENCRYPTION_KEY=$/m);
  for (const secretPath of ['.env*', '.wrangler', '.git', 'node_modules']) assert.ok(read('.dockerignore').includes(secretPath), `Build context must exclude ${secretPath}`);
  assert.ok(read('.gitignore').includes('!.env.docker.example'));
});
