import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ContractFactory, id, parseEther } from 'ethers';
import { simulation, accounts, settled, decodeError } from '../scripts/runtime.mjs';

const titles = ['Purchase supplies', 'Deliver support', 'Final handover'];
const amounts = ['1', '2', '3'].map(parseEther);
let env, people, ledger;

beforeEach(async () => {
  env = await simulation();
  people = await accounts(env.provider);
  const artifact = JSON.parse(fs.readFileSync('artifacts/AidLedgerCloud.json', 'utf8'));
  ledger = await new ContractFactory(artifact.abi, artifact.bytecode, people.organizer).deploy();
  await ledger.waitForDeployment();
});
afterEach(async () => { if (env) await env.close(); });

test('successful request IDs are recorded on-chain and cannot execute twice', async () => {
  const createId = id('create-1');
  await settled(ledger.createCampaign(createId, 'Clean Water for Uselu', id('metadata'),
    people.verifier.address, people.recipient.address, titles, amounts));
  assert.equal(await ledger.processedRequests(createId), true);
  await assert.rejects(
    ledger.createCampaign(createId, 'Another campaign', id('metadata-2'), people.verifier.address,
      people.recipient.address, titles, amounts),
    error => decodeError(ledger, error) === 'DuplicateRequest',
  );
  assert.equal(await ledger.campaignCount(), 1n);
});

test('a request ID in an event recovers the transaction and protects a contribution', async () => {
  await settled(ledger.createCampaign(id('create-2'), 'Clean Water for Uselu', id('metadata'),
    people.verifier.address, people.recipient.address, titles, amounts));
  const requestId = id('contribution-1');
  const receipt = await settled(ledger.connect(people.donor).contribute(requestId, 0, { value: parseEther('2') }));
  const event = receipt.logs.map(log => { try { return ledger.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === 'ContributionAdded');
  assert.equal(event.args.requestId, requestId);
  assert.equal(event.args.amount, parseEther('2'));
  await assert.rejects(
    ledger.connect(people.donor).contribute(requestId, 0, { value: parseEther('2') }),
    error => decodeError(ledger, error) === 'DuplicateRequest',
  );
  assert.equal((await ledger.getCampaign(0)).raised, parseEther('2'));
});

test('cloud lifecycle preserves exact evidence and review fingerprints', async () => {
  await settled(ledger.createCampaign(id('create-3'), 'Clean Water for Uselu', id('metadata'),
    people.verifier.address, people.recipient.address, titles, amounts));
  await settled(ledger.connect(people.donor).contribute(id('fund-3'), 0, { value: parseEther('6') }));
  const evidence = id('evidence-3');
  const review = id('review-3');
  await settled(ledger.submitEvidence(id('submit-3'), 0, 0, evidence));
  await settled(ledger.connect(people.verifier).reviewMilestone(id('verify-3'), 0, 0, 1, evidence, review, true));
  const before = await env.provider.getBalance(people.recipient.address);
  await settled(ledger.releaseFunds(id('release-3'), 0, 0));
  assert.equal(await env.provider.getBalance(people.recipient.address) - before, parseEther('1'));
  const milestone = await ledger.getMilestone(0, 0);
  assert.equal(milestone.evidenceHash, evidence);
  assert.equal(milestone.reviewHash, review);
});
