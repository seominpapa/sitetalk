import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = new URL('../node_modules/@playwright/test/cli.js', import.meta.url);
const child = spawn(process.execPath, [fileURLToPath(runner), 'test', ...process.argv.slice(2)], { stdio: ['inherit', 'pipe', 'pipe'] });
let streamError = false;
for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  let tail = '';
  source.setEncoding('utf8');
  source.on('data', chunk => {
    // A passing HTTP assertion must not hide a Worker request-lifetime error.
    const output = tail + chunk;
    streamError ||= output.includes("Can't read from request stream after response has been sent");
    tail = output.slice(-100);
    target.write(chunk);
  });
}
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  if (streamError) console.error('E2E failed: Worker request-stream error detected.');
  process.exitCode = streamError ? 1 : (code ?? 1);
});
