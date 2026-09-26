'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { HeartHandshake, LayoutDashboard, FolderHeart, ShieldCheck, History, RefreshCw,
  Plus, ArrowLeft, CircleCheck, AlertTriangle, WalletCards } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type Ethereum = { request(input: { method: string; params?: unknown[] }): Promise<unknown>; on?: (event: string, handler: (...args: unknown[]) => void) => void; removeListener?: (event: string, handler: (...args: unknown[]) => void) => void };
declare global { interface Window { ethereum?: Ethereum } }
type Action = { kind: string; [key: string]: unknown };
type RequestRecord = { id: string; requestKey?: string; walletAddress?: string; action: Action; status: string; message: string; hash?: string; blockNumber?: number };
type Milestone = { id: number; title: string; amount: string; amountWei: string; status: string; revision: string; evidenceHash: string; reviewHash: string; evidence: string | null; review: string | null };
type Campaign = { id: string; title: string; location: string; description: string; organizer: string; verifier: string; recipient: string; goal: string; goalWei: string; raised: string; raisedWei: string; released: string; releasedWei: string; available: string; availableWei: string; nextMilestone: number; complete: boolean; milestones: Milestone[] };
type Snapshot = { chainId: number; contractAddress: string; block: number; wallet: string | null; balance: string | null; campaigns: Campaign[]; escrow: string; requests: RequestRecord[] };
type Modal = { kind: 'create' | 'contribute' | 'evidence' | 'review' | 'release'; campaign?: Campaign; milestone?: Milestone };
type Prepared = { record: RequestRecord; transaction: { to: string; data: string; value?: string; chainId: string } };

const API = (process.env.NEXT_PUBLIC_AIDLEDGER_API_URL || '').replace(/\/$/, '');
const KEY = 'aidledger-cloud-request-v1';
const AMOY = '0x13882';
const terminal = new Set(['confirmed', 'reverted', 'wallet_rejected', 'invalid']);
const short = (value = '') => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : '—';
const amount = (value = '0') => value.replace(/\.0$/, '');
const fromWei = (value: bigint) => {
  const unit = BigInt(10) ** BigInt(18); const whole = value / unit; const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
class ApiError extends Error { constructor(message: string, public status = 0) { super(message); } }
async function api<T>(route: string, options?: RequestInit): Promise<T> {
  if (!API) throw new ApiError('Cloud API URL is missing. Set NEXT_PUBLIC_AIDLEDGER_API_URL in Vercel.');
  const response = await fetch(`${API}${route}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: options?.body ? { 'Content-Type': 'application/json', ...options.headers } : options?.headers });
  let value: { error?: string } | T;
  try { value = await response.json(); } catch { throw new ApiError('The cloud service response was interrupted. Keep the saved request ID.'); }
  if (!response.ok) throw new ApiError((value as { error?: string }).error || 'Cloud service unavailable.', response.status);
  return value as T;
}
const post = <T,>(route: string, value: unknown) => api<T>(route, { method: 'POST', body: JSON.stringify(value) });
const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Unexpected error.';
};
type SavedRequest = { id: string; wallet: string; action: Action; hash?: string; error?: string };
function readSaved(): SavedRequest | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as SavedRequest;
  if (!value.id || !value.wallet || !value.action?.kind) throw new Error('Saved request is incomplete. Keep browser storage and inspect Proof history.');
  return value;
}
function mergedRecord(record: RequestRecord, saved: SavedRequest | null): RequestRecord {
  if (!saved || saved.id !== record.id || terminal.has(record.status)) return record;
  const hash = record.hash || saved.hash;
  return { ...record, hash, status: hash ? 'submitted' : saved.error ? 'unknown' : record.status,
    message: saved.error || record.message };
}

export default function CloudDashboard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [account, setAccount] = useState('');
  const [view, setView] = useState('Overview');
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [active, setActive] = useState<RequestRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Connecting to the cloud service…');
  const lock = useRef(false);
  const epoch = useRef(0);
  const walletRef = useRef(account);
  walletRef.current = account;

  const refresh = useCallback(async (wallet = account) => {
    const version = epoch.current;
    try {
      const state = await api<Snapshot>(`/api/state${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''}`);
      if (lock.current || version !== epoch.current || wallet.toLowerCase() !== walletRef.current.toLowerCase()) return;
      setData(state); setNotice('');
      const saved = readSaved();
      if (saved && same(saved.wallet, wallet)) {
        const found = state.requests.find(item => item.id === saved.id);
        if (found) setActive(mergedRecord(found, saved));
        else setActive({ id: saved.id, walletAddress: saved.wallet, action: saved.action,
          hash: saved.hash, status: 'unknown', message: saved.error || 'Request saved in this browser. Check its status before resuming.' });
      }
    } catch (error) { if (!lock.current && version === epoch.current) setNotice(errorText(error)); }
  }, [account]);

  useEffect(() => {
    const ethereum = window.ethereum;
    let disposed = false;
    const accountsChanged = (...args: unknown[]) => {
      if (disposed) return;
      const first = (args[0] as string[])?.[0] || '';
      epoch.current++; walletRef.current = first; setAccount(first); setActive(null); setData(null);
      void refresh(first);
    };
    const chainChanged = () => { epoch.current++; void refresh(walletRef.current); };
    if (ethereum) {
      ethereum.request({ method: 'eth_accounts' }).then(value => accountsChanged(value)).catch(() => void refresh(''));
      ethereum.on?.('accountsChanged', accountsChanged);
      ethereum.on?.('chainChanged', chainChanged);
    } else void refresh('');
    const timer = setInterval(() => { if (!lock.current && document.visibilityState === 'visible') void refresh(walletRef.current); }, 12_000);
    return () => { disposed = true; clearInterval(timer); ethereum?.removeListener?.('accountsChanged', accountsChanged); ethereum?.removeListener?.('chainChanged', chainChanged); };
  }, [refresh]);

  async function connect() {
    const ethereum = window.ethereum;
    if (!ethereum || lock.current) { setNotice('Open MetaMask to connect your wallet.'); return; }
    lock.current = true; epoch.current++; setBusy(true);
    try {
      try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: AMOY }] }); }
      catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: AMOY, chainName: 'Polygon Amoy',
          nativeCurrency: { name: 'Test POL', symbol: 'POL', decimals: 18 }, rpcUrls: ['https://polygon-amoy-bor-rpc.publicnode.com'],
          blockExplorerUrls: ['https://amoy.polygonscan.com'] }] });
      }
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      walletRef.current = accounts[0] || ''; setAccount(walletRef.current); setNotice('');
    } catch (error) { setNotice(errorText(error)); }
    finally { lock.current = false; setBusy(false); }
    void refresh(walletRef.current);
  }

  async function verifyWallet(wallet: string) {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error('Open MetaMask first.');
    const accounts = await ethereum.request({ method: 'eth_accounts' }) as string[];
    if (!same(accounts[0], wallet)) throw new Error('Select the wallet that owns this saved request in MetaMask.');
    if (await ethereum.request({ method: 'eth_chainId' }) !== AMOY) throw new Error('Select Polygon Amoy in MetaMask before continuing.');
    return ethereum;
  }

  // A known transaction hash is always attached/checked, never broadcast again.
  async function reconcileSaved(saved: SavedRequest) {
    const record = saved.hash
      ? await post<RequestRecord>(`/api/requests/${saved.id}/transaction`, { wallet: saved.wallet, hash: saved.hash })
      : await api<RequestRecord>(`/api/requests/${saved.id}?wallet=${encodeURIComponent(saved.wallet)}`);
    if (record.hash) saved.hash = record.hash;
    if (terminal.has(record.status)) delete saved.error;
    localStorage.setItem(KEY, JSON.stringify(saved));
    setActive(mergedRecord(record, saved));
    return record;
  }

  async function sendSaved(saved: SavedRequest, resume: boolean) {
    if (lock.current) return;
    lock.current = true; epoch.current++; setBusy(true); setModal(null); setNotice('');
    let sending = false;
    try {
      const ethereum = await verifyWallet(saved.wallet);
      if (resume) {
        try {
          const current = await reconcileSaved(saved);
          if (current.hash || saved.hash || ['confirmed', 'submitted', 'reverted', 'invalid'].includes(current.status)) return;
          if (!['prepared', 'wallet_rejected'].includes(current.status)) throw new Error('This request needs a status check before resuming.');
        } catch (error) {
          // An interrupted initial prepare can leave only the original browser ID.
          if (!(error instanceof ApiError && error.status === 404 && !saved.hash)) throw error;
        }
        const latest = await ethereum.request({ method: 'eth_getTransactionCount', params: [saved.wallet, 'latest'] }) as string;
        const pending = await ethereum.request({ method: 'eth_getTransactionCount', params: [saved.wallet, 'pending'] }) as string;
        if (BigInt(pending) !== BigInt(latest)) throw new Error('MetaMask RPC reports a pending wallet transaction. Resolve it in Activity, then check status.');
      }
      localStorage.setItem(KEY, JSON.stringify(saved));
      const prepared = await post<Prepared>('/api/requests', { id: saved.id, wallet: saved.wallet, action: saved.action });
      if (prepared.record.id !== saved.id || !same(prepared.record.walletAddress, saved.wallet)) throw new Error('Prepared request does not match the saved wallet and ID.');
      setActive(prepared.record);
      if (prepared.record.hash || ['confirmed', 'submitted', 'reverted', 'invalid'].includes(prepared.record.status)) {
        if (prepared.record.hash) saved.hash = prepared.record.hash;
        localStorage.setItem(KEY, JSON.stringify(saved)); return;
      }
      if (!['prepared', 'wallet_rejected'].includes(prepared.record.status)) throw new Error('Request is not ready to send. Check status.');
      if (prepared.transaction.chainId !== AMOY) throw new Error('Prepared transaction is not for Polygon Amoy.');
      await verifyWallet(saved.wallet);
      delete saved.error;
      localStorage.setItem(KEY, JSON.stringify(saved));
      setActive({ ...prepared.record, status: 'awaiting_wallet', message: 'Review this saved request in MetaMask. Waiting for your decision.' });
      sending = true;
      const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ ...prepared.transaction, from: saved.wallet }] });
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('MetaMask did not return a valid transaction hash. Inspect Activity before resuming.');
      saved.hash = hash;
      setActive({ ...prepared.record, hash, status: 'submitted', message: 'Transaction sent. Saving its hash and checking confirmation.' });
      localStorage.setItem(KEY, JSON.stringify(saved));
      setActive(await reconcileSaved(saved));
    } catch (error) {
      const rejected = sending && !saved.hash && (error as { code?: number }).code === 4001;
      saved.error = rejected ? 'MetaMask request cancelled. You can resume this same request.'
        : `${errorText(error)} ${saved.hash ? 'Hash preserved; use Check status to recover confirmation.' : 'Inspect MetaMask Activity before resuming; an error alone does not prove nothing was sent.'}`;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* The active record still displays the hash. */ }
      if (rejected) { try { await post(`/api/requests/${saved.id}/reject`, { wallet: saved.wallet }); } catch { /* Preserve the cancellation locally. */ } }
      setActive({ id: saved.id, walletAddress: saved.wallet, action: saved.action, hash: saved.hash,
        status: saved.hash ? 'submitted' : rejected ? 'wallet_rejected' : 'unknown', message: saved.error });
    } finally { lock.current = false; setBusy(false); }
  }

  async function run(action: Action) {
    if (!account || lock.current) return;
    try {
      if (active && !terminal.has(active.status)) throw new Error('Resolve the saved request before starting another action.');
      const saved: SavedRequest = { id: crypto.randomUUID(), wallet: account, action };
      localStorage.setItem(KEY, JSON.stringify(saved));
      setActive({ id: saved.id, walletAddress: account, action, status: 'preparing', message: 'Saving the exact wallet request.' });
      await sendSaved(saved, false);
    } catch (error) { setNotice(errorText(error)); }
  }

  function savedFor(record: RequestRecord): SavedRequest {
    const stored = readSaved();
    const owner = record.walletAddress || (stored?.id === record.id ? stored.wallet : '');
    if (!same(owner, account)) throw new Error('Connect the wallet that owns this request.');
    return { id: record.id, wallet: owner, action: record.action,
      hash: record.hash || (stored?.id === record.id ? stored.hash : undefined),
      error: stored?.id === record.id ? stored.error : undefined };
  }

  async function resume() {
    if (!active || !account || lock.current) return;
    try { await sendSaved(savedFor(active), true); }
    catch (error) { setNotice(errorText(error)); }
  }

  async function check(record = active) {
    if (!record || !account || lock.current) return;
    lock.current = true; epoch.current++; setBusy(true);
    try { await reconcileSaved(savedFor(record)); }
    catch (error) { setActive({ ...record, message: errorText(error) }); }
    finally { lock.current = false; setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!modal) return;
    const form = new FormData(event.currentTarget); const field = (name: string) => String(form.get(name) || '');
    let action: Action;
    if (modal.kind === 'create') action = { kind: 'create', title: field('title'), location: field('location'), description: field('description'),
      verifier: field('verifier'), recipient: field('recipient'), milestones: [0, 1, 2].map(i => ({ title: field(`title${i}`), amount: field(`amount${i}`) })) };
    else if (modal.kind === 'contribute') action = { kind: 'contribute', campaignId: modal.campaign!.id, amount: field('amount') };
    else if (modal.kind === 'evidence') action = { kind: 'evidence', campaignId: modal.campaign!.id, milestoneId: modal.milestone!.id, text: field('text') };
    else if (modal.kind === 'review') action = { kind: 'review', campaignId: modal.campaign!.id, milestoneId: modal.milestone!.id,
      evidenceHash: modal.milestone!.evidenceHash, revision: modal.milestone!.revision, approve: field('decision') === 'approve', text: field('text') };
    else action = { kind: 'release', campaignId: modal.campaign!.id, milestoneId: modal.milestone!.id };
    void run(action);
  }

  const campaign = data?.campaigns.find(item => item.id === selected);
  const needsReview = data?.campaigns.flatMap(c => c.milestones.filter(m => m.status === 'pending').map(m => ({ c, m }))) || [];
  const raised = data?.campaigns.reduce((sum, c) => sum + BigInt(c.raisedWei), BigInt(0)) || BigInt(0);
  const released = data?.campaigns.reduce((sum, c) => sum + BigInt(c.releasedWei || '0'), BigInt(0)) || BigInt(0);
  const progress = (c: Campaign) => Number(BigInt(c.raisedWei) * BigInt(100) / BigInt(c.goalWei));
  const blocked = busy || !account || !!active && !terminal.has(active.status);
  const nav = [['Overview', LayoutDashboard], ['Campaigns', FolderHeart], ['Verification', ShieldCheck], ['Proof history', History]] as const;
  const open = (kind: Modal['kind'], c?: Campaign, m?: Milestone) => setModal({ kind, campaign: c, milestone: m });

  return <div className="cl-shell"><aside className="cl-sidebar">
    <a href="/" className="cl-brand"><HeartHandshake size={34}/><span>AidLedger<small>EVERY STEP ACCOUNTED FOR</small></span></a>
    <p className="cl-eyebrow">AMOY WORKSPACE</p><nav>{nav.map(([name, Icon]) => <button key={name} className={view === name ? 'selected' : ''} onClick={() => { setView(name); setSelected(null); }}><Icon size={19}/>{name}{name === 'Verification' && needsReview.length > 0 && <span className="cl-count">{needsReview.length}</span>}</button>)}</nav>
    <div className="cl-sidebar-note"><ShieldCheck/><strong>Wallet signed. Publicly verifiable.</strong><p>The backend stores exact evidence bytes. Polygon stores their fingerprints and escrow state.</p></div><small>Polygon Amoy testnet · v4 recovery</small>
  </aside><div className="cl-main"><header className="cl-top"><span>Workspace / <b>{view}</b></span><div className="cl-inline"><span className={`cl-dot ${data ? 'online' : ''}`}/>{data ? 'Amoy service connected' : 'Disconnected'}<button className="cl-btn secondary" onClick={() => void connect()} disabled={busy}><WalletCards size={16}/>{account ? short(account) : 'Connect MetaMask'}</button></div></header>
  <main className="cl-content">
    {data && <div className="cl-connection"><span>Contract <code>{short(data.contractAddress)}</code></span><span>Block {data.block}</span><span>Chain 80002</span>{account && <span>{amount(data.balance || '0')} test POL</span>}<button className="cl-link" onClick={() => void refresh()}><RefreshCw size={13}/> Refresh</button></div>}
    {notice && <div className="cl-alert"><AlertTriangle size={20}/><span>{notice}</span></div>}
    {active && <section className={`cl-transaction ${active.status === 'confirmed' ? 'success' : ''}`}><div className="cl-row"><h2>{active.status === 'confirmed' ? <CircleCheck size={21}/> : <History size={21}/>} Transaction {active.status.replaceAll('_', ' ')}</h2><span className="cl-badge">{active.action.kind}</span></div><p>{active.message}</p><small>Saved request</small><code className="cl-hash">{active.id}</code>{active.hash && <><small>Transaction hash</small><code className="cl-hash">{active.hash}</code></>}<div className="cl-actions"><button className="cl-btn secondary" onClick={() => void check()} disabled={busy || !account}>Check status</button>{!active.hash && ['prepared', 'unknown', 'wallet_rejected'].includes(active.status) && <button className="cl-btn" disabled={busy || !account} onClick={() => void resume()}>Resume saved request</button>}{terminal.has(active.status) && <button className="cl-btn secondary" disabled={busy} onClick={() => { const saved = readSaved(); if (saved?.id === active.id) localStorage.removeItem(KEY); setActive(null); }}>Dismiss</button>}</div></section>}
    <div className="cl-heading"><div><p className="cl-eyebrow">{campaign ? `CAMPAIGN ${campaign.id}` : 'THE BIG PICTURE'}</p><h1>{campaign?.title || (view === 'Overview' ? 'Good intentions. Visible impact.' : view)}</h1><p className="cl-muted">Track the funding. See the proof. Follow the progress.</p></div><button className="cl-btn" disabled={blocked} onClick={() => open('create')}><Plus size={18}/> Create campaign</button></div>
    {view === 'Overview' && !campaign && <div className="cl-stats">{[['Total raised', fromWei(raised)], ['Funds released', fromWei(released)], ['Held in escrow', amount(data?.escrow)], ['Awaiting review', String(needsReview.length)]].map(([label, value], i) => <div className="cl-card" key={label}><span>{label}</span><strong>{data ? value : '—'}</strong><small>{i === 3 ? 'milestone evidence' : 'test POL'}</small></div>)}</div>}
    {campaign ? <><button className="cl-link" onClick={() => setSelected(null)}><ArrowLeft size={16}/> Back to campaigns</button><section className="cl-card cl-detail"><div className="cl-row"><div><span className="cl-muted">{campaign.location}</span><p>{campaign.description}</p></div><span className="cl-badge">{campaign.complete ? 'Complete' : 'Active'}</span></div><div className="cl-stats mini"><div><strong>{amount(campaign.raised)} / {amount(campaign.goal)}</strong><small>test POL funded</small></div><div><strong>{amount(campaign.available)}</strong><small>test POL available</small></div><div><strong>{amount(campaign.released)}</strong><small>test POL released</small></div></div><progress max="100" value={progress(campaign)}/><div className="cl-addresses">{(['organizer','verifier','recipient'] as const).map(role => <div key={role}><small>{role}</small><code>{campaign[role]}</code></div>)}</div><button className="cl-btn" disabled={blocked || BigInt(campaign.raisedWei) >= BigInt(campaign.goalWei)} onClick={() => open('contribute', campaign)}>Contribute test POL</button></section>
      <h2 className="cl-section-title">Three milestones. A visible trail.</h2>{campaign.milestones.map(m => <section className="cl-card cl-milestone" key={m.id}><div className="cl-row"><h3><span className="cl-step">{m.id + 1}</span>{m.title}</h3><span className={`cl-badge ${m.status}`}>{m.status}</span></div><p><b>{amount(m.amount)} test POL</b> · Evidence revision {m.revision}</p>{m.evidence && <div className="cl-evidence"><small>Exact saved evidence matches the on-chain fingerprint</small><p>{m.evidence}</p><code className="cl-hash">{m.evidenceHash}</code></div>}{m.review && <div className="cl-evidence"><small>Verifier note</small><p>{m.review}</p></div>}{m.id === campaign.nextMilestone && <div className="cl-actions">{['planned','rejected'].includes(m.status) && <button className="cl-btn" disabled={blocked || !same(account, campaign.organizer)} onClick={() => open('evidence', campaign, m)}>Submit evidence</button>}{m.status === 'pending' && <button className="cl-btn" disabled={blocked || !same(account, campaign.verifier) || !m.evidence} onClick={() => open('review', campaign, m)}>Review evidence</button>}{m.status === 'approved' && <button className="cl-btn" disabled={blocked || !same(account, campaign.organizer) || BigInt(campaign.availableWei) < BigInt(m.amountWei)} onClick={() => open('release', campaign, m)}>Release milestone</button>}</div>}</section>)}</>
    : view === 'Overview' || view === 'Campaigns' ? <><div className="cl-row cl-section-title"><h2>Active campaigns <span className="cl-badge">{data?.campaigns.length || 0}</span></h2></div><div className="cl-grid">{data?.campaigns.length ? data.campaigns.map(c => <button className="cl-card cl-campaign" key={c.id} onClick={() => setSelected(c.id)}><div className="cl-row"><FolderHeart size={25}/><span className="cl-badge">{c.complete ? 'Complete' : 'Active campaign'}</span></div><h3>{c.title}</h3><p>{c.location}</p><div className="cl-row"><strong>{amount(c.raised)} <small>test POL</small></strong><span>{progress(c)}%</span></div><progress value={progress(c)} max="100"/><small>of {amount(c.goal)} test POL goal</small></button>) : <section className="cl-card cl-empty"><FolderHeart size={36}/><h2>Your public ledger starts here.</h2><p>Connect MetaMask and create the first Polygon Amoy campaign.</p></section>}</div></>
    : view === 'Verification' ? <div className="cl-grid">{needsReview.length ? needsReview.map(({c,m}) => <section className="cl-card" key={`${c.id}-${m.id}`}><span className="cl-badge pending">Awaiting review</span><h3>{m.title}</h3><p>{c.title} · Revision {m.revision}</p><div className="cl-evidence">{m.evidence || 'Evidence bytes unavailable.'}</div><button className="cl-btn" disabled={!same(account,c.verifier) || blocked || !m.evidence} onClick={() => open('review',c,m)}>Review evidence</button></section>) : <section className="cl-card cl-empty"><ShieldCheck size={32}/><h2>No pending reviews</h2></section>}</div>
    : <section className="cl-card"><h2>Wallet transaction recovery</h2><p className="cl-muted">Request IDs are stored before MetaMask opens and included in every contract event.</p>{data?.requests.length ? data.requests.map(r => <div className="cl-history" key={r.id}><div className="cl-row"><span><b>{r.action.kind}</b> <span className="cl-badge">{r.status}</span></span><button className="cl-link" disabled={busy || !!active && !terminal.has(active.status) && active.id !== r.id} onClick={() => { setActive(r); void check(r); }}>Inspect</button></div><code className="cl-hash">{r.hash || r.requestKey}</code></div>) : <p>Connect a wallet to view its requests.</p>}</section>}
    <footer className="cl-footer">AidLedger · Transparent aid, one milestone at a time.<span>Polygon Amoy uses test tokens only.</span></footer>
  </main></div>
  <Dialog open={!!modal} onOpenChange={openState => { if (!openState && !busy) setModal(null); }}><DialogContent className="cl-dialog"><DialogHeader><DialogTitle>{{create:'Create a campaign',contribute:'Fund this campaign',evidence:'Submit milestone evidence',review:'Review the exact evidence',release:'Release approved funds'}[modal?.kind || 'create']}</DialogTitle><DialogDescription>MetaMask will show the Polygon Amoy transaction before you sign.</DialogDescription></DialogHeader><form className="cl-form" onSubmit={submit}>
    {modal?.kind === 'create' && <><label>Campaign title<input name="title" required minLength={3} maxLength={80}/></label><label>Location<input name="location" required minLength={2} maxLength={80}/></label><label>Description<textarea name="description" required minLength={10} maxLength={800}/></label><label>Verifier wallet<input name="verifier" required pattern="0x[a-fA-F0-9]{40}"/></label><label>Recipient wallet<input name="recipient" required pattern="0x[a-fA-F0-9]{40}"/></label>{['Purchase supplies','Deliver support','Final handover'].map((title,i) => <div className="cl-form-row" key={i}><label>Milestone {i+1}<input name={`title${i}`} defaultValue={title} required/></label><label>Budget (test POL)<input name={`amount${i}`} defaultValue={String(i+1)} required inputMode="decimal"/></label></div>)}</>}
    {modal?.kind === 'contribute' && <label>Contribution (test POL)<input name="amount" defaultValue="1" required inputMode="decimal"/></label>}
    {modal?.kind === 'evidence' && <label>Evidence description<textarea name="text" required minLength={10} maxLength={1500}/></label>}
    {modal?.kind === 'review' && <><div className="cl-evidence">{modal.milestone?.evidence}</div><label>Decision<select name="decision"><option value="approve">Approve evidence</option><option value="reject">Request revision</option></select></label><label>Reason<textarea name="text" required minLength={10} maxLength={600}/></label></>}
    {modal?.kind === 'release' && <p>Release exactly <b>{amount(modal.milestone?.amount)} test POL</b> to <code>{modal.campaign?.recipient}</code>.</p>}
    <div className="cl-actions"><button type="button" className="cl-btn secondary" onClick={() => setModal(null)}>Cancel</button><button className="cl-btn" disabled={busy || !account}>Continue to MetaMask</button></div>
  </form></DialogContent></Dialog></div>;
}
