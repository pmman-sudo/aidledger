import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudLedger, CloudError } from './ledger.mjs';
import { PostgresStore } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const required = name => { if (!process.env[name]) throw new Error(`${name} is required.`); return process.env[name]; };
const origin = required('FRONTEND_ORIGIN').replace(/\/$/, '');
const port = Number(process.env.PORT || 8080);
const ledger = new CloudLedger({ rpcUrl: required('AMOY_RPC_URL'), contractAddress: required('CONTRACT_ADDRESS'),
  deploymentBlock: Number(required('DEPLOYMENT_BLOCK')), artifactPath: path.resolve(here, '../artifacts/AidLedgerCloud.json'),
  store: new PostgresStore(required('DATABASE_URL')) });
await ledger.init();

const buckets = new Map();
function allowed(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > 60_000) { buckets.set(key, { start: now, count: 1 }); return true; }
  bucket.count++;
  return bucket.count <= 120;
}
function headers(extra = {}) { return { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin', ...extra }; }
async function body(req) {
  let value = '';
  for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 20_000) throw new CloudError('Request too large.', 413); }
  try { return JSON.parse(value); } catch { throw new CloudError('Invalid JSON.'); }
}
const server = http.createServer(async (req, res) => {
  const send = (status, value) => { res.writeHead(status, headers()); res.end(JSON.stringify(value)); };
  try {
    if (!allowed(req)) return send(429, { error: 'Too many requests. Try again shortly.' });
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin is not allowed.' });
    if (req.method === 'OPTIONS') { res.writeHead(204, headers()); return res.end(); }
    const url = new URL(req.url, 'http://service');
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, chainId: 80002 });
    if (req.method === 'GET' && url.pathname === '/api/state') return send(200, await ledger.snapshot(url.searchParams.get('wallet')));
    if (req.method === 'POST' && url.pathname === '/api/requests') return send(200, await ledger.prepare(await body(req)));
    let match = /^\/api\/requests\/([a-f0-9-]{36})(?:\/(transaction|reject))?$/i.exec(url.pathname);
    if (match && req.method === 'GET' && !match[2]) return send(200, await ledger.check(match[1], url.searchParams.get('wallet')));
    if (match && req.method === 'POST' && match[2] === 'transaction') { const input = await body(req); return send(200, await ledger.attach(match[1], input.wallet, input.hash)); }
    if (match && req.method === 'POST' && match[2] === 'reject') { const input = await body(req); return send(200, await ledger.reject(match[1], input.wallet)); }
    send(404, { error: 'Endpoint not found.' });
  } catch (error) {
    const status = error instanceof CloudError ? error.status : error?.code === '23505' ? 409 : 500;
    send(status, { error: error instanceof CloudError ? error.message : 'Service error. Keep the saved request ID and check again.' });
    if (!(error instanceof CloudError)) console.error(error);
  }
});
server.requestTimeout = 20_000;
server.listen(port, '0.0.0.0', () => console.log(`AidLedger cloud service listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await ledger.close(); process.exit(0); });
