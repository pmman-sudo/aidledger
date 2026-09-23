import fs from 'node:fs';
import { Contract, Interface, JsonRpcProvider, getAddress, isAddress, keccak256,
  parseEther, toUtf8Bytes, formatEther, ZeroHash } from 'ethers';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^0x[a-f0-9]{64}$/i;
const statuses = ['planned', 'pending', 'approved', 'rejected', 'released'];
const eventNames = ['CampaignCreated', 'ContributionAdded', 'EvidenceSubmitted', 'MilestoneReviewed', 'FundsReleased'];

export class CloudError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function cleanText(value, min, max, label) {
  if (typeof value !== 'string') throw new CloudError(`${label} is required.`);
  const result = value.trim();
  if (Buffer.byteLength(result) < min || Buffer.byteLength(result) > max)
    throw new CloudError(`${label} must contain ${min}–${max} bytes.`);
  return result;
}
function cleanId(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(value)) throw new CloudError('Invalid campaign identifier.');
  return value;
}
function cleanAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,18})?$/.test(value) || parseEther(value) <= 0n)
    throw new CloudError('Enter a positive test POL amount with at most 18 decimals.');
  return value;
}
function cleanAddress(value, label) {
  if (!isAddress(value)) throw new CloudError(`${label} must be a valid wallet address.`);
  return getAddress(value);
}
export function normalizeAction(input) {
  if (!input || typeof input.kind !== 'string') throw new CloudError('Action is required.');
  if (input.kind === 'create') return { kind: 'create', title: cleanText(input.title, 3, 80, 'Campaign title'),
    location: cleanText(input.location, 2, 80, 'Location'), description: cleanText(input.description, 10, 800, 'Description'),
    verifier: cleanAddress(input.verifier, 'Verifier'), recipient: cleanAddress(input.recipient, 'Recipient'),
    milestones: Array.isArray(input.milestones) && input.milestones.length === 3
      ? input.milestones.map(item => ({ title: cleanText(item.title, 3, 100, 'Milestone title'), amount: cleanAmount(item.amount) }))
      : (() => { throw new CloudError('Exactly three milestones are required.'); })() };
  const action = { kind: input.kind, campaignId: cleanId(input.campaignId) };
  if (input.kind === 'contribute') return { ...action, amount: cleanAmount(input.amount) };
  if (!Number.isInteger(input.milestoneId) || input.milestoneId < 0 || input.milestoneId > 2) throw new CloudError('Invalid milestone.');
  action.milestoneId = input.milestoneId;
  if (input.kind === 'evidence') return { ...action, text: cleanText(input.text, 10, 1500, 'Evidence') };
  if (input.kind === 'review') {
    if (!HASH.test(input.evidenceHash) || typeof input.revision !== 'string' || !/^\d{1,20}$/.test(input.revision) || typeof input.approve !== 'boolean')
      throw new CloudError('Review must bind to the displayed evidence revision and hash.');
    return { ...action, text: cleanText(input.text, 10, 600, 'Review note'), evidenceHash: input.evidenceHash.toLowerCase(),
      revision: input.revision, approve: input.approve };
  }
  if (input.kind === 'release') return action;
  throw new CloudError('Unsupported action.');
}
const canonical = value => JSON.stringify(value);
const document = (kind, body) => { const bytes = canonical(body); return { kind, body, bytes, hash: keccak256(toUtf8Bytes(bytes)) }; };
const wireTransaction = (tx, chainId) => ({ to: tx.to, data: tx.data,
  ...(tx.value ? { value: `0x${BigInt(tx.value).toString(16)}` } : {}), chainId: `0x${chainId.toString(16)}` });
const publicRecord = record => record && ({ id: record.id, requestKey: record.request_key,
  walletAddress: record.wallet_address, action: record.action, status: record.status,
  hash: record.transaction_hash, blockNumber: record.block_number === null ? undefined : Number(record.block_number),
  message: record.error || ({ prepared: 'Prepared and saved before opening MetaMask.', submitted: 'Wallet transaction submitted.',
    confirmed: 'Confirmed on Polygon Amoy.', reverted: 'Transaction reverted. No contract state change was committed.',
    wallet_rejected: 'The wallet rejected or cancelled the request.', invalid: 'The attached transaction does not match this saved request.',
    unknown: 'No receipt found yet. Check again before retrying.' }[record.status] || record.status),
  createdAt: record.created_at });

export class CloudLedger {
  constructor({ rpcUrl, contractAddress, deploymentBlock, artifactPath, store }) {
    this.chainId = 80002;
    this.provider = new JsonRpcProvider(rpcUrl, this.chainId, { staticNetwork: true, batchMaxCount: 1 });
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    this.contract = new Contract(getAddress(contractAddress), artifact.abi, this.provider);
    this.interface = new Interface(artifact.abi);
    this.deploymentBlock = deploymentBlock;
    this.store = store;
  }
  async init() {
    await this.store.init();
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.chainId) throw new Error(`RPC must use Polygon Amoy chain ${this.chainId}.`);
    if ((await this.provider.getCode(this.contract.target)) === '0x') throw new Error('Configured contract has no deployed bytecode.');
  }
  async prepare({ id, wallet, action: input }) {
    if (!UUID.test(id)) throw new CloudError('A version-4 UUID request identifier is required.');
    const walletAddress = cleanAddress(wallet, 'Connected wallet');
    const action = normalizeAction(input);
    const actionBytes = canonical(action);
    const prior = await this.store.get(id);
    if (prior) {
      if (prior.wallet_address !== walletAddress.toLowerCase() || prior.action_bytes !== actionBytes) throw new CloudError('Request ID already belongs to different details.', 409);
      return { record: publicRecord(await this.reconcile(prior)),
        transaction: wireTransaction(await this.transaction(prior.request_key, action, prior.document_hash), this.chainId) };
    }
    const requestKey = keccak256(toUtf8Bytes(id));
    let doc = null;
    if (action.kind === 'create') doc = document('metadata', { title: action.title, location: action.location, description: action.description, milestones: action.milestones });
    if (action.kind === 'evidence') doc = document('evidence', { campaignId: action.campaignId, milestoneId: action.milestoneId, text: action.text });
    if (action.kind === 'review') {
      const evidence = await this.store.document(action.evidenceHash);
      if (!evidence || keccak256(toUtf8Bytes(evidence.canonical_bytes)) !== action.evidenceHash) throw new CloudError('Exact evidence bytes are unavailable; review is blocked.', 409);
      doc = document('review', { campaignId: action.campaignId, milestoneId: action.milestoneId, evidenceHash: action.evidenceHash,
        revision: action.revision, text: action.text, approve: action.approve });
    }
    const tx = await this.transaction(requestKey, action, doc?.hash);
    try { await this.provider.estimateGas({ ...tx, from: walletAddress }); }
    catch (error) { throw new CloudError(error.shortMessage || 'The contract rejected this action. Refresh and check the connected wallet.', 409); }
    const record = await this.store.create({ record: { id, requestKey, chainId: this.chainId,
      contractAddress: this.contract.target, walletAddress, action, actionBytes }, document: doc });
    return { record: publicRecord(record), transaction: wireTransaction(tx, this.chainId) };
  }
  async transaction(requestKey, action, documentHash) {
    if (action.kind === 'create') return this.contract.createCampaign.populateTransaction(requestKey, action.title, documentHash,
      action.verifier, action.recipient, action.milestones.map(x => x.title), action.milestones.map(x => parseEther(x.amount)));
    if (action.kind === 'contribute') return this.contract.contribute.populateTransaction(requestKey, action.campaignId, { value: parseEther(action.amount) });
    if (action.kind === 'evidence') return this.contract.submitEvidence.populateTransaction(requestKey, action.campaignId, action.milestoneId, documentHash);
    if (action.kind === 'review') return this.contract.reviewMilestone.populateTransaction(requestKey, action.campaignId, action.milestoneId,
      action.revision, action.evidenceHash, documentHash, action.approve);
    return this.contract.releaseFunds.populateTransaction(requestKey, action.campaignId, action.milestoneId);
  }
  async attach(id, wallet, hash) {
    if (!HASH.test(hash)) throw new CloudError('Invalid transaction hash.');
    const record = await this.store.get(id);
    if (!record) throw new CloudError('Prepared request not found.', 404);
    if (record.wallet_address !== cleanAddress(wallet, 'Connected wallet').toLowerCase()) throw new CloudError('This request belongs to another wallet.', 403);
    if (record.transaction_hash && record.transaction_hash !== hash.toLowerCase()) throw new CloudError('A different transaction is already attached.', 409);
    const transaction = await this.provider.getTransaction(hash);
    if (transaction) this.validateTransaction(record, transaction);
    return publicRecord(await this.reconcile(await this.store.attach(id, hash)));
  }
  async reject(id, wallet) {
    const record = await this.store.get(id);
    if (!record) throw new CloudError('Prepared request not found.', 404);
    if (record.wallet_address !== cleanAddress(wallet, 'Connected wallet').toLowerCase()) throw new CloudError('This request belongs to another wallet.', 403);
    return publicRecord(await this.store.update(id, { status: 'wallet_rejected' }));
  }
  async check(id, wallet) {
    const record = await this.store.get(id);
    if (!record) throw new CloudError('Prepared request not found.', 404);
    if (record.wallet_address !== cleanAddress(wallet, 'Connected wallet').toLowerCase()) throw new CloudError('This request belongs to another wallet.', 403);
    return publicRecord(await this.reconcile(record));
  }
  async recoverHash(requestKey) {
    if (!await this.contract.processedRequests(requestKey)) return null;
    for (const name of eventNames) {
      const logs = await this.contract.queryFilter(this.contract.filters[name](requestKey), this.deploymentBlock, 'latest');
      if (logs.length) return logs[0].transactionHash;
    }
    return null;
  }
  validateTransaction(record, transaction) {
    try {
      if (!transaction.to || transaction.to.toLowerCase() !== this.contract.target.toLowerCase() ||
          transaction.from.toLowerCase() !== record.wallet_address) throw new Error('wallet or destination mismatch');
      const parsed = this.interface.parseTransaction({ data: transaction.data, value: transaction.value });
      if (!parsed || String(parsed.args[0]).toLowerCase() !== record.request_key) throw new Error('request key mismatch');
    } catch (error) { throw new CloudError(`Attached transaction is unrelated to this request (${error.message}).`, 409); }
  }
  async reconcile(record) {
    let hash = record.transaction_hash;
    if (!hash) hash = await this.recoverHash(record.request_key);
    if (!hash) return record;
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt) return this.store.update(record.id, { status: 'submitted', transactionHash: hash });
    const transaction = await this.provider.getTransaction(hash);
    try { if (!transaction) throw new CloudError('Mined transaction details are unavailable.', 409); this.validateTransaction(record, transaction); }
    catch (error) { return this.store.update(record.id, { status: 'invalid', transactionHash: hash,
      blockNumber: receipt.blockNumber, error: error.message }); }
    return this.store.update(record.id, { status: receipt.status === 1 ? 'confirmed' : 'reverted',
      transactionHash: hash, blockNumber: receipt.blockNumber });
  }
  async snapshot(wallet) {
    const walletAddress = wallet ? cleanAddress(wallet, 'Connected wallet') : null;
    const count = await this.contract.campaignCount();
    if (count > 100n) throw new CloudError('Dashboard campaign limit reached.', 409);
    const campaigns = [];
    for (let i = 0n; i < count; i++) {
      const c = await this.contract.getCampaign(i);
      const metadata = await this.store.document(c.metadataHash);
      const milestones = [];
      for (let n = 0; n < 3; n++) {
        const m = await this.contract.getMilestone(i, n);
        const evidence = await this.store.document(m.evidenceHash);
        const review = await this.store.document(m.reviewHash);
        milestones.push({ id: n, title: m.title, amount: formatEther(m.amount), amountWei: m.amount.toString(), status: statuses[Number(m.status)],
          evidenceHash: m.evidenceHash, reviewHash: m.reviewHash, revision: m.revision.toString(), evidence: evidence?.body?.text || null, review: review?.body?.text || null });
      }
      campaigns.push({ id: i.toString(), title: c.title, location: metadata?.body?.location || 'Metadata unavailable', description: metadata?.body?.description || '',
        organizer: c.organizer, verifier: c.verifier, recipient: c.recipient, goal: formatEther(c.goal), goalWei: c.goal.toString(), raised: formatEther(c.raised),
        raisedWei: c.raised.toString(), released: formatEther(c.released), releasedWei: c.released.toString(), available: formatEther(c.available),
        availableWei: c.available.toString(), nextMilestone: Number(c.nextMilestone), complete: c.complete, milestones });
    }
    const requests = walletAddress ? await this.store.list(walletAddress) : [];
    const block = await this.provider.getBlockNumber();
    const balance = walletAddress ? formatEther(await this.provider.getBalance(walletAddress)) : null;
    return { chainId: this.chainId, contractAddress: this.contract.target, block, wallet: walletAddress, balance,
      campaigns, escrow: formatEther(await this.contract.totalEscrowed()), requests: requests.map(publicRecord) };
  }
  close() { this.provider.destroy(); return this.store.close(); }
}
