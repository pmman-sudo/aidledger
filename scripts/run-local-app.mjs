import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createLocalServer } from './local-server.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = createLocalServer({ root });
let child; let closing = false;
async function close(code = 0) {
  if (closing) return; closing = true;
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await app.close(); process.exitCode = code;
}
app.server.on('error', error => { console.error(`Local service could not start: ${error.message}`); process.exitCode = 1; });
app.server.listen(8787, '127.0.0.1', () => {
  console.log('AidLedger contract service ready. Open http://127.0.0.1:5173 when Next.js says Ready.');
  console.log('Keep your Hardhat node running. Local test ETH only.');
  child = spawn(process.execPath, [path.join(root, 'frontend/node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '5173'], { cwd: path.join(root, 'frontend'), stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); void close(1); });
  child.on('exit', code => { void close(code ?? 0); });
});
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
