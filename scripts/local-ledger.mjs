import fs from 'node:fs';
import path from 'node:path';
import { Contract, HDNodeWallet, Transaction, keccak256, toUtf8Bytes, parseEther, formatEther } from 'ethers';
import { decodeError } from './runtime.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^0x[a-f0-9]{64}$/i;
const statuses = ['planned', 'pending', 'approved', 'rejected', 'released'];
const roles = { Organizer: 0, Verifier: 1, Donor: 2 };
const terminal = new Set(['confirmed', 'reverted', 'replaced', 'not_sent', 'node_reset']);
const messages = {
  OrganizerOnly: 'Use this campaign’s organizer account.', VerifierOnly: 'Use the designated verifier account.',
  WrongMilestoneOrder: 'Release the preceding milestone first.', InvalidStatus: 'This milestone no longer allows that action. Refresh its state.',
  StaleEvidence: 'Evidence changed. Reopen the review and examine its current revision.',
  InsufficientCampaignBalance: 'Add enough funding to cover this milestone before releasing it.',
  FundingGoalExceeded: 'The contribution exceeds the remaining campaign goal.', TransferFailed: 'The recipient rejected the transfer. No release was recorded.',
  CampaignComplete: 'All milestones are already released.', ConflictingRoles: 'The verifier must be different from the organizer and recipient.'
};
export class LocalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function text(value, min, max, name) {
  if (typeof value !== 'string' || value.trim().length < min || Buffer.byteLength(value, 'utf8') > max) throw new LocalError(`${name} must contain ${min}–${max} bytes of text.`);
  return value.trim();
}
function id(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(value)) throw new LocalError('Invalid campaign identifier.');
  return value;
}
function amount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,18})?$/.test(value) || parseEther(value) <= 0n) throw new LocalError('Enter a positive local ETH amount with at most 18 decimal places.');
  return value;
}
export function normalize(input) {
  if (!input || !Object.hasOwn(roles, input.role)) throw new LocalError('Select a supported local account.');
  const action = { kind: input.kind, role: input.role };
  if (input.kind === 'create') return { ...action, title: text(input.title, 3, 80, 'Campaign title'),
    description: text(input.description, 10, 800, 'Campaign description'), location: text(input.location, 2, 80, 'Location'),
    milestones: Array.isArray(input.milestones) && input.milestones.length === 3 ? input.milestones.map(m => ({ title: text(m.title, 3, 100, 'Milestone title'), amount: amount(m.amount) })) : (() => { throw new LocalError('Exactly three milestones are required.'); })() };
  action.campaignId = id(input.campaignId);
  if (input.kind === 'contribute') return { ...action, amount: amount(input.amount) };
  if (!Number.isInteger(input.milestoneId) || input.milestoneId < 0 || input.milestoneId > 2) throw new LocalError('Invalid milestone.');
  action.milestoneId = input.milestoneId;
  if (input.kind === 'evidence') return { ...action, text: text(input.text, 10, 1500, 'Evidence') };
  if (input.kind === 'review') {
    if (!HASH.test(input.evidenceHash) || typeof input.revision !== 'string' || !/^[0-9]{1,20}$/.test(input.revision) || typeof input.approve !== 'boolean') throw new LocalError('The review must include its displayed evidence hash, revision, and decision.');
    return { ...action, text: text(input.text, 10, 600, 'Review note'), evidenceHash: input.evidenceHash, revision: input.revision, approve: input.approve };
  }
  if (input.kind === 'release') return action;
  throw new LocalError('Unsupported action.');
}
export class LocalLedger {
  constructor({ root, provider }) {
    this.root = root; this.provider = provider; this.queue = Promise.resolve();
    this.file = path.join(root, 'deployments', 'ui-journal.json');
    this.store = { version: 1, requests: {}, documents: {} };
    if (fs.existsSync(this.file)) {
      this.store = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.store.version !== 1 || !this.store.requests || !this.store.documents) throw new Error('Invalid UI journal. Preserve deployments/ui-journal.json and inspect it.');
      for (const [key, record] of Object.entries(this.store.requests)) {
        if (!UUID.test(key) || key !== record.id || !record.action || typeof record.session !== 'string') throw new Error('Invalid saved request. Preserve the UI journal.');
        if (record.raw && (keccak256(record.raw) !== record.hash || Transaction.from(record.raw).chainId !== 31337n)) throw new Error('Invalid signed transaction in the UI journal.');
      }
      for (const [hash, bytes] of Object.entries(this.store.documents)) if (typeof bytes !== 'string' || keccak256(toUtf8Bytes(bytes)) !== hash) throw new Error('A saved evidence document has changed. Preserve the UI journal.');
    }
  }
  serial(work) { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  save(next) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.store = next;
  }
  put(record, documents = {}) {
    this.save({ ...this.store, requests: { ...this.store.requests, [record.id]: record }, documents: { ...this.store.documents, ...documents } });
    return record;
  }
  public(record) { const { raw, ...safe } = record; return safe; }
  async connection() {
    let deployment;
    try { deployment = JSON.parse(fs.readFileSync(path.join(this.root, 'deployments', 'localhost.json'), 'utf8')); }
    catch { throw new LocalError('Deployment file unavailable. Run npm.cmd run deploy:local from the contracts folder.', 503); }
    try {
      const chainId = BigInt(await this.provider.send('eth_chainId', []));
      if (chainId !== 31337n) throw new Error('Only chain 31337 is allowed.');
      const metadata = await this.provider.send('hardhat_metadata', []);
      if (!HASH.test(metadata.instanceId)) throw new Error('A local Hardhat instance identifier is required.');
      const artifact = JSON.parse(fs.readFileSync(path.join(this.root, 'artifacts', 'AidLedger.json'), 'utf8'));
      if (await this.provider.getCode(deployment.contractAddress) !== artifact.deployedBytecode) throw new Error('Contract missing or different. Redeploy on the current local node.');
      const receipt = await this.provider.getTransactionReceipt(deployment.transactionHash);
      if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== deployment.contractAddress.toLowerCase()) throw new Error('Deployment receipt missing. Run deploy:local on this node.');
      const contract = new Contract(deployment.contractAddress, artifact.abi, this.provider);
      return { deployment, contract, session: `${metadata.instanceId}:${receipt.blockHash}:${deployment.contractAddress.toLowerCase()}` };
    } catch (error) {
      if (error instanceof LocalError) throw error;
      throw new LocalError(`Local chain unavailable or mismatched. Keep npm.cmd run node running. ${error.shortMessage || error.message}`, 503);
    }
  }
  wallet(role, deployment) {
    // Public Hardhat test mnemonic only. Never accept or load a user's wallet secret.
    const wallet = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, `m/44'/60'/0'/0/${roles[role]}`);
    if (wallet.address.toLowerCase() !== deployment.accounts[role.toLowerCase()]?.toLowerCase()) throw new LocalError('This app requires the package’s default Hardhat test accounts.', 409);
    return wallet;
  }
  error(contract, error) {
    const code = decodeError(contract, error);
    return code ? `${code}: ${messages[code] || 'The contract rejected this action.'}` : (error.shortMessage || 'The action could not be prepared. Refresh and check the local node.');
  }
  async reconcile(record, context) {
    if (record.session !== context.session) return this.put({ ...record, status: 'node_reset', message: 'This request belongs to an earlier local node or deployment. It cannot be replayed here.' });
    if (!record.hash) return record;
    const receipt = await this.provider.getTransactionReceipt(record.hash);
    let next;
    if (receipt) next = { ...record, status: receipt.status === 1 ? 'confirmed' : 'reverted', blockNumber: receipt.blockNumber,
      message: receipt.status === 1 ? 'Confirmed on the local blockchain.' : 'Transaction reverted. No contract state change was committed; test gas was spent.' };
    else {
      const tx = await this.provider.getTransaction(record.hash);
      const nonce = await this.provider.getTransactionCount(record.from, 'latest');
      next = { ...record, status: tx ? 'pending' : nonce > record.nonce ? 'replaced' : 'unknown',
        message: tx ? 'Submitted; waiting for a mined receipt.' : nonce > record.nonce ? 'Another transaction consumed this nonce. Inspect current chain state; do not automatically repeat the action.' : 'No receipt found. Check again or resend the exact saved signed transaction.' };
    }
    return this.put(next);
  }
  async check(requestId) {
    return this.serial(async () => {
      const record = this.store.requests[requestId];
      if (!record) throw new LocalError('Saved request not found. You may submit the same browser request identifier again.', 404);
      const context = await this.connection();
      return this.public(await this.reconcile(record, context));
    });
  }
  async broadcast(record, context) {
    const current = await this.connection();
    if (current.session !== record.session) return this.public(await this.reconcile(record, current));
    try { await this.provider.send('eth_sendRawTransaction', [record.raw]); }
    catch { /* A lost response is not evidence of failure. Check the saved hash below. */ }
    try { return this.public(await this.reconcile(record, context)); }
    catch { return this.public(this.put({ ...record, status: 'unknown', message: 'Broadcast outcome is unknown. The signed transaction is saved; check its status.' })); }
  }
  async resend(requestId) {
    return this.serial(async () => {
      const original = this.store.requests[requestId];
      if (!original) throw new LocalError('Saved request not found.', 404);
      const context = await this.connection();
      const record = await this.reconcile(original, context);
      if (terminal.has(record.status)) return this.public(record);
      if (!record.raw) throw new LocalError('There is no signed transaction to resend.', 409);
      return this.broadcast(record, context);
    });
  }
  async submit(input) {
    return this.serial(async () => {
      if (!UUID.test(input?.id) || typeof input.session !== 'string') throw new LocalError('A saved request identifier and current chain session are required.');
      const action = normalize(input.action);
      const context = await this.connection();
      const prior = this.store.requests[input.id];
      if (prior) {
        if (JSON.stringify(prior.action) !== JSON.stringify(action) || prior.session !== input.session) throw new LocalError('Request identifier already used with different details.', 409);
        return this.public(await this.reconcile(prior, context));
      }
      if (input.session !== context.session) throw new LocalError('The local node changed. Refresh before creating a new request.', 409);
      if (Object.keys(this.store.requests).length >= 500) throw new LocalError('The local recovery journal reached its 500-request limit.', 409);
      for (const pending of Object.values(this.store.requests).filter(r => r.session === context.session && !terminal.has(r.status))) {
        const checked = await this.reconcile(pending, context);
        if (!terminal.has(checked.status)) throw new LocalError(`Resolve request ${checked.id} before sending a new transaction.`, 409);
      }
      let record = { id: input.id, action, session: context.session, createdAt: new Date().toISOString(), status: 'preparing' };
      const documents = {};
      const commit = value => { const bytes = JSON.stringify(value); const hash = keccak256(toUtf8Bytes(bytes)); documents[hash] = bytes; return hash; };
      const { contract, deployment } = context;
      let raw;
      try {
        const wallet = this.wallet(action.role, deployment);
        let request;
        if (action.kind === 'create') {
          if (await contract.campaignCount() >= 30n) throw new LocalError('This local UI supports at most 30 campaigns.');
          const metadataHash = commit({ title: action.title, location: action.location, description: action.description, milestones: action.milestones });
          request = await contract.createCampaign.populateTransaction(action.title, metadataHash, deployment.accounts.verifier, deployment.accounts.recipient, action.milestones.map(m => m.title), action.milestones.map(m => parseEther(m.amount)));
        } else if (action.kind === 'contribute') request = await contract.contribute.populateTransaction(action.campaignId, { value: parseEther(action.amount) });
        else if (action.kind === 'evidence') request = await contract.submitEvidence.populateTransaction(action.campaignId, action.milestoneId,
          commit({ campaignId: action.campaignId, milestoneId: action.milestoneId, text: action.text }));
        else if (action.kind === 'review') {
          if (!this.store.documents[action.evidenceHash]) throw new LocalError('Evidence bytes are unavailable in the local journal. Restore them before approving.');
          request = await contract.reviewMilestone.populateTransaction(action.campaignId, action.milestoneId, action.revision, action.evidenceHash,
            commit({ campaignId: action.campaignId, milestoneId: action.milestoneId, evidenceHash: action.evidenceHash, revision: action.revision, text: action.text, approve: action.approve }), action.approve);
        } else request = await contract.releaseFunds.populateTransaction(action.campaignId, action.milestoneId);
        const gas = await this.provider.estimateGas({ ...request, from: wallet.address });
        const nonce = await this.provider.getTransactionCount(wallet.address, 'pending');
        const fee = (await this.provider.getFeeData()).gasPrice;
        if (!fee) throw new Error('Local gas price unavailable.');
        raw = await wallet.signTransaction({ ...request, type: 0, chainId: 31337, nonce, gasPrice: fee, gasLimit: gas * 120n / 100n });
        record = { ...record, from: wallet.address, nonce, hash: keccak256(raw), raw, status: 'prepared', message: 'Signed transaction saved before broadcast.' };
      } catch (error) {
        record = { ...record, status: 'not_sent', message: error instanceof LocalError ? error.message : this.error(contract, error) };
        return this.public(this.put(record));
      }
      // Persist the exact signed bytes and documents before any side effect on-chain.
      this.put(record, documents);
      return this.broadcast(record, context);
    });
  }
  document(hash) {
    const bytes = this.store.documents[hash];
    if (!bytes || keccak256(toUtf8Bytes(bytes)) !== hash) return null;
    return JSON.parse(bytes);
  }
  async snapshot() {
    return this.serial(async () => {
      const context = await this.connection();
      const { contract, deployment, session } = context;
      for (const record of Object.values(this.store.requests).filter(r => !terminal.has(r.status))) await this.reconcile(record, context);
      const count = await contract.campaignCount();
      if (count > 30n) throw new LocalError('This local dashboard supports at most 30 campaigns.', 409);
      const campaigns = [];
      for (let i = 0n; i < count; i++) {
        const c = await contract.getCampaign(i);
        const metadata = this.document(c.metadataHash);
        const milestones = [];
        for (let n = 0; n < 3; n++) {
          const m = await contract.getMilestone(i, n);
          milestones.push({ id: n, title: m.title, amount: formatEther(m.amount), amountWei: m.amount.toString(), status: statuses[Number(m.status)], evidenceHash: m.evidenceHash,
            reviewHash: m.reviewHash, revision: m.revision.toString(), evidence: this.document(m.evidenceHash)?.text || null, review: this.document(m.reviewHash)?.text || null });
        }
        campaigns.push({ id: i.toString(), title: c.title, location: metadata?.location || 'Metadata unavailable locally', description: metadata?.description || '',
          organizer: c.organizer, verifier: c.verifier, recipient: c.recipient, metadataHash: c.metadataHash,
          goal: formatEther(c.goal), goalWei: c.goal.toString(), raised: formatEther(c.raised), raisedWei: c.raised.toString(), released: formatEther(c.released),
          releasedWei: c.released.toString(), available: formatEther(c.available), availableWei: c.available.toString(), nextMilestone: Number(c.nextMilestone), complete: c.complete, milestones });
      }
      const block = await this.provider.getBlockNumber();
      const logs = await this.provider.getLogs({ address: deployment.contractAddress, fromBlock: Math.max(deployment.deploymentBlock, block - 10000), toBlock: block });
      const events = logs.slice(-150).reverse().flatMap(log => {
        let e; try { e = contract.interface.parseLog(log); } catch { return []; }
        return e ? [{ id: `${log.transactionHash}:${log.index}`, name: e.name, campaignId: e.args.campaignId.toString(),
          hash: log.transactionHash, block: log.blockNumber, milestoneId: e.args.milestoneId?.toString() ?? null, amount: e.args.amount !== undefined ? formatEther(e.args.amount) : null }] : [];
      });
      const accounts = {};
      for (const role of ['organizer','verifier','donor','recipient']) accounts[role] = { address: deployment.accounts[role], balance: formatEther(await this.provider.getBalance(deployment.accounts[role])) };
      return { session, chainId: 31337, contractAddress: deployment.contractAddress, block, campaignCount: count.toString(), campaigns, events, accounts,
        totalRaised: formatEther(campaigns.reduce((s, c) => s + BigInt(c.raisedWei), 0n)), totalReleased: formatEther(campaigns.reduce((s,c)=>s+BigInt(c.releasedWei),0n)),
        escrow: formatEther(await contract.totalEscrowed()), requests: Object.values(this.store.requests).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30).map(r => this.public(r.session === session ? r : { ...r, status: 'node_reset', message: 'Archived request from an earlier local node.' })) };
    });
  }
}
