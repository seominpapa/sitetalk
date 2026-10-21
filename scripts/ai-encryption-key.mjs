import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

await mkdir('.wrangler/secrets', { recursive: true, mode: 0o700 });
await writeFile('.wrangler/secrets/ai-settings-encryption.key', `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
console.log('AI encryption key saved privately in .wrangler/secrets/ai-settings-encryption.key; existing keys are never overwritten.');
