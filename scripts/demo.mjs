import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseEther, formatEther, keccak256, toUtf8Bytes } from 'ethers';
import { simulation, accounts, deploy, settled, decodeError, hashFile, json, Status } from './runtime.mjs';

const env = await simulation();
try {
  const people = await accounts(env.provider);
  const ledger = await deploy(env.provider, people.organizer);
  const sample = JSON.parse(await fs.readFile('samples/campaign.json', 'utf8'));
  const records = [];
  const blocked = [];
  await fs.mkdir('reports', { recursive: true });

  async function record(label, transaction) {
    const receipt = await settled(transaction);
    const events = receipt.logs.flatMap(log => {
      try {
        const parsed = ledger.interface.parseLog(log);
        if (!parsed) return [];
        const args = Object.fromEntries(parsed.fragment.inputs.map((input, i) => [input.name, parsed.args[i]]));
        return [{ name: parsed.name, args }];
      } catch { return []; }
    });
    records.push({ label, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, events });
    console.log(`OK  ${label}`);
  }
  async function expectBlocked(label, expected, action) {
    let didRevert = false;
    try { await action(); }
    catch (error) {
      assert.equal(decodeError(ledger, error), expected);
      didRevert = true;
    }
    assert.equal(didRevert, true, `${label} should have been blocked`);
    blocked.push({ label, reason: expected });
    console.log(`BLOCKED  ${label} (${expected})`);
  }

  console.log('\nAIDLEDGER — LOCAL CONTRACT DEMO');
  console.log('Chain: 31337 | Currency: valueless local ETH | Three separate action accounts\n');
  await record('Create a campaign with budgets 1 + 2 + 3 local ETH', ledger.createCampaign(
    sample.title, await hashFile('samples/campaign.json'), people.verifier.address, people.recipient.address,
    sample.milestones.map(m => m.title), sample.milestones.map(m => parseEther(m.localEthBudget)),
  ));
  await record('Donor contributes 2.5 local ETH', ledger.connect(people.donor).contribute(0, { value: parseEther('2.5') }));

  const firstHash = await hashFile('samples/evidence.json');
  const firstReview = await hashFile('samples/review.json');
  await record('Organizer submits the first evidence fingerprint', ledger.submitEvidence(0, 0, firstHash));
  await expectBlocked('Organizer tries to approve their own evidence', 'VerifierOnly',
    () => ledger.reviewMilestone.staticCall(0, 0, 1, firstHash, firstReview, true));
  await expectBlocked('Organizer tries to release before approval', 'InvalidStatus',
    () => ledger.releaseFunds.staticCall(0, 0));
  await record('Verifier approves the first milestone', ledger.connect(people.verifier).reviewMilestone(0, 0, 1, firstHash, firstReview, true));
  assert.equal((await ledger.getCampaign(0)).released, 0n);
  await record('Organizer releases exactly 1 local ETH to the recipient', ledger.releaseFunds(0, 0));
  await expectBlocked('Organizer tries the same release again', 'WrongMilestoneOrder',
    () => ledger.releaseFunds.staticCall(0, 0));

  for (const milestoneId of [1, 2]) {
    const evidenceDocument = {
      schema: 'aidledger.evidence.v1', fictional: true,
      milestone: sample.milestones[milestoneId].title,
      summary: 'Fictional completion record for this local programming demonstration.',
    };
    const reviewDocument = { schema: 'aidledger.review.v1', fictional: true,
      milestone: evidenceDocument.milestone, decision: 'approve', note: 'Sample evidence matches the fictional plan.' };
    const evidenceBytes = json(evidenceDocument), reviewBytes = json(reviewDocument);
    await fs.writeFile(`reports/evidence-${milestoneId + 1}.json`, evidenceBytes);
    await fs.writeFile(`reports/review-${milestoneId + 1}.json`, reviewBytes);
    const evidenceHash = keccak256(toUtf8Bytes(evidenceBytes)), reviewHash = keccak256(toUtf8Bytes(reviewBytes));
    await record(`Submit evidence for milestone ${milestoneId + 1}`, ledger.submitEvidence(0, milestoneId, evidenceHash));
    await record(`Approve milestone ${milestoneId + 1}`, ledger.connect(people.verifier).reviewMilestone(0, milestoneId, 1, evidenceHash, reviewHash, true));
    if (milestoneId === 1) {
      await expectBlocked('Release exceeds this campaign’s available balance', 'InsufficientCampaignBalance',
        () => ledger.releaseFunds.staticCall(0, 1));
      await record('Donor supplies the remaining 3.5 local ETH', ledger.connect(people.donor).contribute(0, { value: parseEther('3.5') }));
    }
    await record(`Release milestone ${milestoneId + 1}`, ledger.releaseFunds(0, milestoneId));
    assert.equal((await ledger.getMilestone(0, milestoneId)).status, Status.Released);
  }

  const final = await ledger.getCampaign(0);
  assert.equal(final.complete, true);
  assert.equal(final.released, parseEther('6'));
  assert.equal(final.available, 0n);
  assert.equal(await env.provider.getBalance(ledger.target), 0n);
  const report = {
    mode: 'ephemeral local simulation', chainId: 31337,
    contractAddress: ledger.target,
    accounts: Object.fromEntries(Object.entries(people).map(([role, signer]) => [role, signer.address])),
    result: { raisedLocalEth: formatEther(final.raised), releasedLocalEth: formatEther(final.released),
      availableLocalEth: formatEther(final.available), complete: final.complete },
    blocked, transactions: records,
    note: 'These transactions existed only on this run’s local simulation. This report is not a public-chain proof.',
  };
  await fs.writeFile('reports/demo-result.json', json(report));
  console.log('\nCOMPLETE: 6 local ETH contributed, 6 released, 0 remaining; all 3 milestones released.');
  console.log('Report: reports/demo-result.json');
  console.log('This temporary local chain is now discarded. Your hosted dashboard is not connected yet.\n');
} finally { await env.close(); }
