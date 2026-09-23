import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { id, parseEther, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes } from 'ethers';
import { simulation, accounts, deploy, settled, decodeError, Status, hashFile } from '../scripts/runtime.mjs';

const titles = ['Purchase supplies', 'Deliver supplies', 'Confirm handover'];
const amounts = ['1', '2', '3'].map(parseEther);
const evidence = id('fictional-evidence-v1');
const review = id('fictional-review-v1');
let env, people, ledger;

beforeEach(async () => {
  env = await simulation();
  people = await accounts(env.provider);
  ledger = await deploy(env.provider, people.organizer);
});
afterEach(async () => { if (env) await env.close(); });

async function create(overrides = {}) {
  const who = overrides.organizer ?? people.organizer;
  const campaignId = await ledger.campaignCount();
  await settled(ledger.connect(who).createCampaign(
    overrides.title ?? 'Fictional community aid', overrides.metadata ?? id('metadata'),
    overrides.verifier ?? people.verifier.address, overrides.recipient ?? people.recipient.address,
    overrides.titles ?? titles, overrides.amounts ?? amounts,
  ));
  return campaignId;
}
async function fund(amount = '6', campaignId = 0n, donor = people.donor) {
  return settled(ledger.connect(donor).contribute(campaignId, { value: parseEther(amount) }));
}
async function submit(milestoneId = 0, hash = evidence, campaignId = 0n) {
  return settled(ledger.submitEvidence(campaignId, milestoneId, hash));
}
async function approve(milestoneId = 0, campaignId = 0n) {
  const milestone = await ledger.getMilestone(campaignId, milestoneId);
  return settled(ledger.connect(people.verifier).reviewMilestone(
    campaignId, milestoneId, milestone.revision, milestone.evidenceHash, review, true,
  ));
}
async function expectError(name, action) {
  await assert.rejects(action, error => {
    assert.equal(decodeError(ledger, error), name, `Expected ${name}; received ${error.message}`);
    return true;
  });
}

test('creation fixes the organizer, verifier, recipient, and three milestone budgets', async () => {
  await create();
  const c = await ledger.getCampaign(0);
  assert.equal(c.organizer, people.organizer.address);
  assert.equal(c.verifier, people.verifier.address);
  assert.equal(c.recipient, people.recipient.address);
  assert.equal(c.goal, parseEther('6'));
  assert.equal(c.available, 0n);
  assert.equal(c.complete, false);
  assert.equal((await ledger.getMilestone(0, 2)).amount, parseEther('3'));
});

test('a verifier cannot be the organizer or recipient', async () => {
  await expectError('ConflictingRoles', () => create({ verifier: people.organizer.address }));
  await expectError('ConflictingRoles', () => create({ verifier: people.recipient.address }));
  assert.equal(await ledger.campaignCount(), 0n);
});

test('rejects zero addresses and the escrow itself as a participant', async () => {
  await expectError('InvalidAddress', () => create({ verifier: ZeroAddress }));
  await expectError('InvalidAddress', () => create({ recipient: ZeroAddress }));
  await expectError('InvalidAddress', () => create({ recipient: ledger.target }));
  await expectError('InvalidAddress', () => create({ verifier: ledger.target }));
});

test('invalid metadata, titles, and zero budgets do not create campaigns', async () => {
  await expectError('EmptyHash', () => create({ metadata: ZeroHash }));
  await expectError('InvalidTitle', () => create({ title: 'ab' }));
  await expectError('InvalidTitle', () => create({ title: 'a'.repeat(101) }));
  await expectError('InvalidTitle', () => create({ titles: ['ab', 'Delivery', 'Handover'] }));
  await expectError('InvalidBudget', () => create({ amounts: [0n, 2n, 3n] }));
  assert.equal(await ledger.campaignCount(), 0n);
});

test('contributions are tracked by donor, campaign, and total escrow', async () => {
  await create(); await fund('1'); await fund('0.25'); await fund('0.5', 0n, people.donorTwo);
  assert.equal(await ledger.contributions(0, people.donor.address), parseEther('1.25'));
  assert.equal(await ledger.contributions(0, people.donorTwo.address), parseEther('0.5'));
  assert.equal((await ledger.getCampaign(0)).raised, parseEther('1.75'));
  assert.equal(await ledger.totalEscrowed(), parseEther('1.75'));
  assert.equal(await env.provider.getBalance(ledger.target), parseEther('1.75'));
});

test('zero contributions and overfunding are rejected', async () => {
  await create();
  await expectError('PositiveContributionRequired', () => fund('0'));
  await fund('5.99');
  await expectError('FundingGoalExceeded', () => fund('0.02'));
  await fund('0.01');
  assert.equal((await ledger.getCampaign(0)).raised, parseEther('6'));
});

test('invalid campaign and milestone IDs fail explicitly', async () => {
  await expectError('InvalidCampaign', () => ledger.getCampaign(0));
  await expectError('InvalidCampaign', () => fund('1', 99n));
  await create();
  await expectError('InvalidMilestone', () => ledger.getMilestone(0, 3));
  await expectError('InvalidMilestone', () => ledger.submitEvidence(0, 3, evidence));
});

test('only the campaign organizer may submit evidence', async () => {
  await create();
  await expectError('OrganizerOnly', () => ledger.connect(people.donor).submitEvidence(0, 0, evidence));
  await expectError('OrganizerOnly', () => ledger.connect(people.verifier).submitEvidence(0, 0, evidence));
  await submit();
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Pending);
});

test('later milestones remain locked until the preceding release', async () => {
  await create(); await fund();
  await expectError('WrongMilestoneOrder', () => submit(1));
  await submit(); await approve();
  await expectError('WrongMilestoneOrder', () => submit(1));
  await settled(ledger.releaseFunds(0, 0)); await submit(1);
  assert.equal((await ledger.getMilestone(0, 1)).status, Status.Pending);
});

test('empty evidence and replacing pending evidence are rejected', async () => {
  await create();
  await expectError('EmptyHash', () => submit(0, ZeroHash));
  await submit();
  await expectError('InvalidStatus', () => submit(0, id('replacement')));
  assert.equal((await ledger.getMilestone(0, 0)).evidenceHash, evidence);
});

test('only the designated verifier can approve, regardless of account labels', async () => {
  await create(); await submit();
  for (const signer of [people.organizer, people.donor, people.stranger, people.recipient]) {
    await expectError('VerifierOnly', () => ledger.connect(signer).reviewMilestone(0, 0, 1, evidence, review, true));
  }
  await approve();
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Approved);
});

test('cannot review unsubmitted evidence or omit the review fingerprint', async () => {
  await create();
  await expectError('InvalidStatus', () => ledger.connect(people.verifier).reviewMilestone(0, 0, 1, evidence, review, true));
  await submit();
  await expectError('EmptyHash', () => ledger.connect(people.verifier).reviewMilestone(0, 0, 1, evidence, ZeroHash, true));
});

test('review binds to both the exact evidence hash and its revision', async () => {
  await create(); await submit();
  await expectError('StaleEvidence', () => ledger.connect(people.verifier).reviewMilestone(0, 0, 2, evidence, review, true));
  await expectError('StaleEvidence', () => ledger.connect(people.verifier).reviewMilestone(0, 0, 1, id('different'), review, true));
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Pending);
});

test('rejected evidence can be revised; old reviews cannot approve the new revision', async () => {
  await create(); await fund(); await submit();
  await settled(ledger.connect(people.verifier).reviewMilestone(0, 0, 1, evidence, review, false));
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Rejected);
  await expectError('InvalidStatus', () => ledger.releaseFunds(0, 0));
  const revised = id('fictional-evidence-v2'); await submit(0, revised);
  const m = await ledger.getMilestone(0, 0);
  assert.equal(m.revision, 2n); assert.equal(m.reviewHash, ZeroHash);
  await expectError('StaleEvidence', () => ledger.connect(people.verifier).reviewMilestone(0, 0, 1, evidence, review, true));
  await approve(); await settled(ledger.releaseFunds(0, 0));
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Released);
  assert.equal((await ledger.queryFilter(ledger.filters.EvidenceSubmitted())).length, 2);
});

test('approval alone cannot move funds and cannot be changed silently', async () => {
  await create(); await fund(); await submit(); await approve();
  assert.equal((await ledger.getCampaign(0)).released, 0n);
  assert.equal(await env.provider.getBalance(ledger.target), parseEther('6'));
  await expectError('InvalidStatus', () => submit(0, id('changed')));
  await expectError('InvalidStatus', () => approve());
});

test('planned or pending milestones cannot be released', async () => {
  await create(); await fund();
  await expectError('InvalidStatus', () => ledger.releaseFunds(0, 0));
  await submit();
  await expectError('InvalidStatus', () => ledger.releaseFunds(0, 0));
});

test('only the organizer can initiate a release', async () => {
  await create(); await fund(); await submit(); await approve();
  for (const signer of [people.verifier, people.donor, people.recipient, people.stranger]) {
    await expectError('OrganizerOnly', () => ledger.connect(signer).releaseFunds(0, 0));
  }
});

test('insufficient campaign balance blocks release until more funding arrives', async () => {
  await create(); await fund('0.5'); await submit(); await approve();
  await expectError('InsufficientCampaignBalance', () => ledger.releaseFunds(0, 0));
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Approved);
  await fund('0.5'); await settled(ledger.releaseFunds(0, 0));
  assert.equal((await ledger.getCampaign(0)).available, 0n);
});

test('a campaign cannot spend another campaign’s available balance', async () => {
  await create(); await create(); await fund('0.5', 0n); await fund('6', 1n);
  await submit(); await approve();
  await expectError('InsufficientCampaignBalance', () => ledger.releaseFunds(0, 0));
  assert.equal((await ledger.getCampaign(1)).available, parseEther('6'));
});

test('a release transfers exactly its budget to the fixed recipient', async () => {
  await create(); await fund(); await submit(); await approve();
  const before = await env.provider.getBalance(people.recipient.address);
  const receipt = await settled(ledger.releaseFunds(0, 0));
  assert.equal(await env.provider.getBalance(people.recipient.address) - before, parseEther('1'));
  const c = await ledger.getCampaign(0);
  assert.equal(c.released, parseEther('1')); assert.equal(c.available, parseEther('5'));
  assert.equal(await ledger.totalEscrowed(), parseEther('5'));
  const log = receipt.logs.map(l => ledger.interface.parseLog(l)).find(l => l.name === 'FundsReleased');
  assert.equal(log.args.evidenceHash, evidence); assert.equal(log.args.reviewHash, review);
  assert.equal(log.args.recipient, people.recipient.address);
});

test('a released milestone cannot be released twice', async () => {
  await create(); await fund(); await submit(); await approve(); await settled(ledger.releaseFunds(0, 0));
  await expectError('WrongMilestoneOrder', () => ledger.releaseFunds(0, 0));
  assert.equal((await ledger.getCampaign(0)).released, parseEther('1'));
});

test('all three milestones complete in order with exact conservation of funds', async () => {
  await create(); await fund();
  for (let i = 0; i < 3; i++) {
    await submit(i, id(`evidence-${i}`)); await approve(i); await settled(ledger.releaseFunds(0, i));
    const c = await ledger.getCampaign(0);
    assert.equal(c.available + c.released, c.raised);
    assert.equal(await env.provider.getBalance(ledger.target), await ledger.totalEscrowed());
  }
  const c = await ledger.getCampaign(0);
  assert.equal(c.complete, true); assert.equal(c.available, 0n);
  assert.equal(c.released, parseEther('6'));
  await expectError('CampaignComplete', () => fund('1'));
  await expectError('CampaignComplete', () => ledger.releaseFunds(0, 2));
  await expectError('CampaignComplete', () => submit(2));
});

test('direct transfers are rejected so normal deposits cannot bypass campaign accounting', async () => {
  await expectError('DirectTransferNotSupported', () => people.donor.sendTransaction({ to: ledger.target, value: 1n }));
  await expectError('DirectTransferNotSupported', () => people.donor.sendTransaction({ to: ledger.target, data: '0x12345678', value: 1n }));
});

test('permissions belong to each campaign, not one global organizer', async () => {
  await create(); await create({ organizer: people.stranger });
  await expectError('OrganizerOnly', () => ledger.submitEvidence(1, 0, evidence));
  await settled(ledger.connect(people.stranger).submitEvidence(1, 0, evidence));
});

test('a failed recipient transfer rolls back accounting and remains retryable', async () => {
  const harness = await deploy(env.provider, people.organizer, 'RecipientHarness', [ledger.target]);
  await settled(harness.create(people.verifier.address)); await fund('3');
  await settled(harness.submit(0, evidence)); await approve(); await settled(harness.setMode(1));
  await expectError('TransferFailed', () => harness.release(0));
  const c = await ledger.getCampaign(0);
  assert.equal(c.released, 0n); assert.equal(c.nextMilestone, 0n);
  assert.equal(await ledger.totalEscrowed(), parseEther('3'));
  assert.equal((await ledger.getMilestone(0, 0)).status, Status.Approved);
  assert.equal((await ledger.queryFilter(ledger.filters.FundsReleased())).length, 0);
  await settled(harness.setMode(0)); await settled(harness.release(0));
  assert.equal(await env.provider.getBalance(harness.target), parseEther('1'));
});

test('recipient callbacks cannot reenter a release and drain the remaining escrow', async () => {
  const harness = await deploy(env.provider, people.organizer, 'RecipientHarness', [ledger.target]);
  await settled(harness.create(people.verifier.address)); await fund('3');
  await settled(harness.submit(0, evidence)); await approve(); await settled(harness.setMode(2));
  await settled(harness.release(0));
  assert.equal(await harness.attempted(), true); assert.equal(await harness.reentrySucceeded(), false);
  assert.equal(await harness.callbackError(), ledger.interface.getError('ReentrantCall').selector);
  assert.equal(await env.provider.getBalance(harness.target), parseEther('1'));
  assert.equal((await ledger.getCampaign(0)).available, parseEther('2'));
});

test('sample evidence hashes are reproducible and change when the bytes change', async () => {
  const a = await hashFile('samples/evidence.json');
  assert.equal(a, await hashFile('samples/evidence.json'));
  assert.notEqual(a, keccak256(toUtf8Bytes('different fictional evidence')));
});

test('the constructor refuses a simulated network with a non-local chain ID', async () => {
  const { network } = await import('hardhat');
  const { BrowserProvider, ContractFactory } = await import('ethers');
  const { artifact } = await import('../scripts/runtime.mjs');
  // Still an entirely local simulation; no external RPC endpoint is contacted.
  const other = await network.create({ network: 'aidledger', override: { chainId: 31338 } });
  const provider = new BrowserProvider(other.provider);
  try {
    assert.equal((await provider.getNetwork()).chainId, 31338n);
    const data = await artifact();
    const factory = new ContractFactory(data.abi, data.bytecode, await provider.getSigner(0));
    await expectError('LocalChainOnly', () => factory.deploy());
  } finally { await provider.destroy(); await other.close(); }
});
