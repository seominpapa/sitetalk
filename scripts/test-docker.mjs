import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { localDockerEnvironment } from './docker-daemon.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'site-talk-docker-test-'));
await chmod(directory, 0o700);
const project = `site-talk-test-${randomBytes(6).toString('hex')}`;
const image = `site-talk-test:${project}`;
const envFile = path.join(directory, 'runtime.env');
const overrideFile = path.join(directory, 'compose.yaml');
const credentialsFile = path.join(directory, 'administrator.json');
const stateFile = path.join(directory, 'state.json');
const dockerBin = '/Applications/Docker.app/Contents/Resources/bin';
let environment = { ...process.env, PATH: `${existsSync(dockerBin) ? dockerBin + path.delimiter : ''}${process.env.PATH}`, SITE_TALK_ENV_FILE: envFile };
const compose = ['compose', '--project-name', project, '--env-file', envFile, '-f', path.join(root, 'compose.yaml'), '-f', overrideFile];
const secrets = ['sk-docker-only-not-a-real-api-key'];
const sanitize = text => secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), text);

function command(executable, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const process = spawn(executable, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => process.kill('SIGTERM'), timeout);
    timer.unref();
    process.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-2_000_000); });
    process.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-2_000_000); });
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${executable} command failed (${code ?? 'terminated'}): ${sanitize(stdout + stderr)}`));
    });
  });
}
const docker = (args, timeout) => command('docker', [...compose, ...args], timeout);
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function health(origin) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error('Isolated Docker container did not become healthy');
}

let started = false;
try {
  assert.match(project, /^site-talk-test-[a-f0-9]{12}$/);
  environment = await localDockerEnvironment(environment, async context =>
    (await command('docker', ['context', 'inspect', ...(context ? [context] : []), '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim());
  const port = await freePort();
  environment.SITE_TALK_PORT = String(port);
  const origin = `http://127.0.0.1:${port}`;
  const encryptionKey = randomBytes(32).toString('base64');
  secrets.push(encryptionKey);
  await writeFile(envFile, `PUBLIC_ORIGIN=${origin}\nSITE_TALK_PORT=${port}\nAI_SETTINGS_ENCRYPTION_KEY=${encryptionKey}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(overrideFile, `services:\n  app:\n    image: ${image}\n`, { mode: 0o600, flag: 'wx' });
  console.log('Docker: validating and building an isolated fresh installation');
  await docker(['config', '--quiet']);
  started = true;
  await docker(['up', '-d', '--build'], 600_000);
  await health(origin);
  const created = await docker(['exec', '-T', 'app', 'node', 'apps/server/admin.mjs', '--email', 'owner@example.invalid', '--name', '설치관리자']);
  const receipt = created.stdout.match(/\/data\/accounts\/[a-f0-9-]{36}\.json/);
  assert.ok(receipt, 'Administrator CLI must return only a private receipt path');
  await docker(['cp', `app:${receipt[0]}`, credentialsFile]);
  await chmod(credentialsFile, 0o600);
  const admin = JSON.parse(await readFile(credentialsFile, 'utf8'));
  assert.equal(admin.role, 'admin');
  assert.equal(admin.status, 'created');
  assert.equal(admin.password.length, 32);
  secrets.push(admin.password, `${admin.password}1!`);
  assert.equal(created.stdout.includes(admin.password), false);
  console.log('Docker: testing installer login, approvals, API settings and two-browser chat');
  Object.assign(environment, {
    DOCKER_E2E_BASE_URL: origin,
    DOCKER_E2E_CREDENTIALS_FILE: credentialsFile,
    DOCKER_E2E_STATE_FILE: stateFile,
    DOCKER_E2E_OUTPUT_DIR: path.join(directory, 'browser-results'),
  });
  const browser = await command(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.docker.config.ts'], 180_000);
  console.log(sanitize(browser.stdout).trim());

  console.log('Docker: recreating the container and checking persistent database, files and encrypted API settings');
  await docker(['stop', 'app']);
  await docker(['up', '-d', '--force-recreate', '--no-build']);
  await health(origin);
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: admin.email, password: admin.password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const request = async route => {
    const response = await fetch(origin + route, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, route);
    return response;
  };
  const stats = (await (await request('/api/admin/stats')).json()).data;
  assert.equal(stats.users.length, 3);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const history = (await (await request(`/api/rooms/${state.roomId}/messages`)).json()).data;
  assert.ok(history.some(message => message.content === 'Docker에서 안전 작업 계획을 공유합니다.'));
  assert.ok(history.some(message => message.content === '현장팀원이 실시간으로 확인했습니다.'));
  const file = Buffer.from(await (await request(state.attachmentPath)).arrayBuffer());
  assert.deepEqual(file, Buffer.from(state.pdf, 'base64'));
  const settings = (await (await request('/api/admin/ai-settings')).json()).data;
  assert.equal(settings.configured, true);
  assert.equal(settings.source, 'database');
  assert.equal(JSON.stringify(settings).includes('sk-docker-'), false);
  const schedules = (await (await request('/api/summary-schedules')).json()).data;
  assert.equal(schedules.find(site => site.site_id === state.siteId).enabled, false);
  const logs = await docker(['logs', '--no-color', 'app']);
  assert.doesNotMatch(logs.stdout + logs.stderr, /request_failed|http_transport_failed|ERR_STREAM|stream.*(?:errored|closed)|schedule_failed/i);
  console.log('Docker: browser checks and recreate/persistence checks passed; no real API key or production data used');
} catch (error) {
  console.error(sanitize(error.message));
  process.exitCode = 1;
} finally {
  if (started) {
    try { await docker(['down', '--volumes', '--remove-orphans']); }
    catch { console.error(`Docker test cleanup failed for isolated project ${project}`); process.exitCode = 1; }
    try { await command('docker', ['image', 'rm', image]); } catch {}
  }
  assert.ok(path.basename(directory).startsWith('site-talk-docker-test-'));
  await rm(directory, { recursive: true, force: true });
}
