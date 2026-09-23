import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Contract, Interface, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import { CloudLedger, CloudError, normalizeAction } from '../cloud/ledger.mjs';

test('cloud input normalization rejects malformed wallet and milestone input', () => {
  assert.throws(() => normalizeAction({ kind: 'create', title: 'Valid title', location: 'NG',
    description: 'Long enough description', verifier: 'bad', recipient: 'bad', milestones: [] }), CloudError);
  assert.throws(() => normalizeAction({ kind: 'release', campaignId: '0', milestoneId: 3 }), CloudError);
});

test('prepare persists a canonical request and returns only an unsigned wallet transaction', async () => {
  const artifact = JSON.parse(fs.readFileSync('artifacts/AidLedgerCloud.json', 'utf8'));
  const contractAddress = getAddress('0x1000000000000000000000000000000000000001');
  const wallet = getAddress('0x2000000000000000000000000000000000000002');
  const verifier = getAddress('0x3000000000000000000000000000000000000003');
  const recipient = getAddress('0x4000000000000000000000000000000000000004');
  let saved;
  const store = {
    get: async () => null,
    create: async input => { saved = input; return { id: input.record.id, request_key: input.record.requestKey,
      wallet_address: input.record.walletAddress.toLowerCase(), action: input.record.action,
      status: 'prepared', transaction_hash: null, block_number: null, created_at: new Date() }; },
  };
  const ledger = Object.create(CloudLedger.prototype);
  ledger.chainId = 80002; ledger.store = store;
  ledger.contract = new Contract(contractAddress, artifact.abi);
  ledger.interface = new Interface(artifact.abi);
  ledger.provider = { estimateGas: async () => 100000n };
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const result = await ledger.prepare({ id, wallet, action: { kind: 'create', title: 'Clean Water for Uselu',
    location: 'Uselu, Edo State', description: 'Deliver water supplies with visible milestones.', verifier, recipient,
    milestones: [{ title: 'Purchase supplies', amount: '1' }, { title: 'Deliver support', amount: '2' }, { title: 'Final handover', amount: '3' }] } });
  assert.equal(saved.record.requestKey, keccak256(toUtf8Bytes(id)));
  assert.equal(saved.document.hash, keccak256(toUtf8Bytes(saved.document.bytes)));
  assert.deepEqual(Object.keys(result.transaction).sort(), ['chainId', 'data', 'to']);
  const decoded = ledger.interface.parseTransaction(result.transaction);
  assert.equal(decoded.args[0], saved.record.requestKey);
  assert.equal(result.record.status, 'prepared');
});

test('an unrelated transaction hash cannot be attached to a saved request', () => {
  const artifact = JSON.parse(fs.readFileSync('artifacts/AidLedgerCloud.json', 'utf8'));
  const ledger = Object.create(CloudLedger.prototype);
  ledger.contract = new Contract('0x1000000000000000000000000000000000000001', artifact.abi);
  ledger.interface = new Interface(artifact.abi);
  assert.throws(() => ledger.validateTransaction({ wallet_address: '0x2000000000000000000000000000000000000002',
    request_key: `0x${'11'.repeat(32)}` }, { to: ledger.contract.target, from: '0x3000000000000000000000000000000000000003',
    data: ledger.interface.encodeFunctionData('contribute', [`0x${'11'.repeat(32)}`, 0]), value: 1n }), CloudError);
});
