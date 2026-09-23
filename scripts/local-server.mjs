import http from 'node:http';
import { FetchRequest, JsonRpcProvider } from 'ethers';
import { LocalLedger, LocalError } from './local-ledger.mjs';
export function createLocalServer({ root, provider }) {
  const rpc = new FetchRequest('http://127.0.0.1:8545'); rpc.timeout = 5000;
  const ownProvider = provider || new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const ledger = new LocalLedger({ root, provider: ownProvider });
  const server = http.createServer(async (req, res) => {
    function json(code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(403, { error: 'Use the local application URL.' });
      const origin = req.headers.origin;
      if (origin && origin !== 'http://127.0.0.1:5173') return json(403, { error: 'Foreign origins are not allowed.' });
      if (req.method === 'POST' && (origin !== 'http://127.0.0.1:5173' || req.headers['x-aidledger-local'] !== '1' || req.headers['content-type'] !== 'application/json')) return json(403, { error: 'Use the local AidLedger dashboard for actions.' });
      const route = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && route === '/api/state') return json(200, await ledger.snapshot());
      const match = /^\/api\/requests\/([a-f0-9-]{36})(\/resend)?$/i.exec(route);
      if (req.method === 'GET' && match && !match[2]) return json(200, await ledger.check(match[1]));
      if (req.method === 'POST' && match?.[2]) return json(200, await ledger.resend(match[1]));
      if (req.method === 'POST' && route === '/api/requests') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(413, { error: 'Request too large.' }); }
        let input; try { input = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON.' }); }
        const result = await ledger.submit(input);
        if (input.loseResponse === true && result.hash) return res.destroy();
        return json(200, result);
      }
      json(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (!res.destroyed) json(error instanceof LocalError ? error.status : 500, { error: error instanceof LocalError ? error.message : 'Local service error. Check the saved request before sending again.' });
      if (!(error instanceof LocalError)) console.error('Local service:', error.message);
    }
  });
  server.requestTimeout = 15000;
  return { server, ledger, close: async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); if (!provider) ownProvider.destroy(); } };
}
