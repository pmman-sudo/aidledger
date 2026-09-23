'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { HeartHandshake, LayoutDashboard, FolderHeart, ShieldCheck, History, ArrowUpRight, RefreshCw, Plus, ArrowLeft, CircleCheck, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type Role = 'Organizer' | 'Verifier' | 'Donor';
type Action = { kind: string; role: Role; [key: string]: unknown };
type Envelope = { id: string; session: string; action: Action };
type RequestRecord = Envelope & { status: string; message: string; hash?: string; blockNumber?: number; createdAt?: string };
type Milestone = { id: number; title: string; amount: string; amountWei: string; status: string; revision: string; evidenceHash: string; reviewHash: string; evidence: string | null; review: string | null };
type Campaign = { id: string; title: string; location: string; description: string; organizer: string; verifier: string; recipient: string; goal: string; goalWei: string; raised: string; raisedWei: string; released: string; available: string; availableWei: string; nextMilestone: number; complete: boolean; milestones: Milestone[] };
type Snapshot = { session: string; chainId: number; contractAddress: string; block: number; campaigns: Campaign[]; totalRaised: string; totalReleased: string; escrow: string; accounts: Record<string, { address: string; balance: string }>; requests: RequestRecord[]; events: { id: string; name: string; campaignId: string; hash: string; block: number; amount: string | null }[] };
type Modal = { kind: 'create' | 'contribute' | 'evidence' | 'review' | 'release'; campaign?: Campaign; milestone?: Milestone };
const KEY = 'aidledger-chain-request-v1';
const terminal = new Set(['confirmed', 'not_sent', 'reverted', 'replaced', 'node_reset']);
const short = (s = '') => s ? `${s.slice(0, 8)}…${s.slice(-6)}` : '—';
const eth = (s = '0') => s.replace(/\.0$/, '');
class ApiError extends Error { constructor(message: string, public status = 0) { super(message); } }
async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/local${route}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'x-aidledger-local': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let value; try { value = await response.json(); } catch { throw new ApiError('Connection interrupted. Check the saved request before sending again.'); }
  if (!response.ok) throw new ApiError((value as { error?: string })?.error || 'Local service unavailable.', response.status);
  return value as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Local service unavailable.';

export default function ConnectedDashboard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState('Connecting to the local contract service…');
  const [storageError, setStorageError] = useState('');
  const [role, setRole] = useState<Role>('Organizer');
  const [view, setView] = useState('Overview');
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [active, setActive] = useState<RequestRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [loseResponse, setLoseResponse] = useState(false);
  const [search, setSearch] = useState('');
  const envelope = useRef<Envelope | null>(null);
  const lock = useRef(false);
  const refreshLock = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshLock.current || lock.current) return;
    refreshLock.current = true;
    try {
      const state = await api<Snapshot>('/state'); setData(state); setOnline(true); setNotice('');
      if (envelope.current) {
        const found = state.requests.find(r => r.id === envelope.current?.id);
        if (found) setActive(found);
        else if (envelope.current.session !== state.session) setActive({ ...envelope.current, status: 'node_reset', message: 'This saved request belongs to an earlier node or deployment. It will not be replayed.' });
      }
    } catch (error) { setOnline(false); setNotice(message(error)); }
    finally { refreshLock.current = false; }
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const item = JSON.parse(saved);
        if (typeof item.id !== 'string' || typeof item.session !== 'string' || !item.action) throw new Error('Invalid saved request.');
        envelope.current = item; setActive({ ...item, status: 'unknown', message: 'Recovered your saved request. Checking the local blockchain…' });
      }
      localStorage.setItem(KEY + '-probe', '1'); localStorage.removeItem(KEY + '-probe');
    } catch { setStorageError('Browser storage is unavailable or the saved request is damaged. Actions are paused; keep this browser data and inspect it before continuing.'); }
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  function remember(item: Envelope) {
    try { localStorage.setItem(KEY, JSON.stringify(item)); envelope.current = item; return true; }
    catch { setStorageError('Could not save the request identifier. No new transaction was sent.'); return false; }
  }
  async function send(item: Envelope) {
    if (lock.current || storageError || !remember(item)) return;
    lock.current = true; setBusy(true); setModal(null);
    setActive({ ...item, status: 'preparing', message: 'Request saved. Preparing and submitting your local transaction…' });
    const drop = loseResponse; setLoseResponse(false);
    try { setActive(await api<RequestRecord>('/requests', { ...item, loseResponse: drop })); }
    catch (error) { setActive({ ...item, status: error instanceof ApiError && [400, 413].includes(error.status) ? 'not_sent' : 'unknown', message: `${message(error)}${error instanceof ApiError && [400, 413].includes(error.status) ? ' Correct the form and try again.' : ' Keep this identifier and check status.'}` }); }
    finally { lock.current = false; setBusy(false); if (!drop) void refresh(); }
  }
  async function recover(mode: 'check' | 'resend', item = envelope.current) {
    if (!item || lock.current || !remember(item)) return;
    lock.current = true; setBusy(true);
    try { setActive(await api<RequestRecord>(`/requests/${item.id}${mode === 'resend' ? '/resend' : ''}`, mode === 'resend' ? {} : undefined)); }
    catch (error) { setActive({ ...item, status: error instanceof ApiError && error.status === 404 ? 'not_found' : 'unknown', message: message(error) }); }
    finally { lock.current = false; setBusy(false); }
  }
  function dismiss() {
    try { localStorage.removeItem(KEY); envelope.current = null; setActive(null); }
    catch { setStorageError('Browser storage could not be updated.'); }
  }
  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || !modal || blocked) return;
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) || '');
    let action: Action = { kind: modal.kind, role };
    if (modal.kind === 'create') action = { ...action, title: field('title'), location: field('location'), description: field('description'), milestones: [0, 1, 2].map(i => ({ title: field(`title${i}`), amount: field(`amount${i}`) })) };
    else {
      action.campaignId = modal.campaign!.id;
      if (modal.kind === 'contribute') action.amount = field('amount');
      else {
        action.milestoneId = modal.milestone!.id;
        if (modal.kind === 'evidence' || modal.kind === 'review') action.text = field('text');
        if (modal.kind === 'review') { action.evidenceHash = modal.milestone!.evidenceHash; action.revision = modal.milestone!.revision; action.approve = field('decision') === 'approve'; }
      }
    }
    void send({ id: crypto.randomUUID(), session: data.session, action });
  }
  const pending = data?.requests.find(r => !terminal.has(r.status));
  const blocked = busy || !online || !!storageError || !!(active && !terminal.has(active.status)) || !!pending;
  const campaign = data?.campaigns.find(c => c.id === selected);
  const signer = data?.accounts[role.toLowerCase()];
  const needsReview = data?.campaigns.flatMap(c => c.milestones.filter(m => m.status === 'pending').map(m => ({ c, m }))) || [];
  const nav = [['Overview', LayoutDashboard], ['Campaigns', FolderHeart], ['Verification', ShieldCheck], ['Proof history', History]] as const;
  const open = (kind: Modal['kind'], c?: Campaign, m?: Milestone) => { setModal({ kind, campaign: c, milestone: m }); };
  const progress = (c: Campaign) => Number(BigInt(c.raisedWei) * BigInt(100) / BigInt(c.goalWei));
  const campaignCards = (data?.campaigns || []).filter(c => `${c.title} ${c.location}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="cl-shell">
    <aside className="cl-sidebar">
      <a href="/" className="cl-brand"><HeartHandshake size={34} /><span>AidLedger<small>EVERY STEP ACCOUNTED FOR</small></span></a>
      <p className="cl-eyebrow">WORKSPACE</p>
      <nav aria-label="Workspace">{nav.map(([name, Icon]) => <button key={name} className={view === name ? 'selected' : ''} onClick={() => { setView(name); setSelected(null); }}><Icon size={19} />{name}{name === 'Verification' && needsReview.length > 0 && <span className="cl-count">{needsReview.length}</span>}</button>)}</nav>
      <div className="cl-sidebar-note"><ShieldCheck /><strong>Purpose. Proof. Progress.</strong><p>Evidence and review fingerprints are recorded before each milestone release.</p></div>
      <a href="/browser-demo" className="cl-demo-link">Open the original browser demo <ArrowUpRight size={16} /></a>
      <small>Local contract workspace · v2</small>
    </aside>
    <div className="cl-main">
      <header className="cl-top"><span>Workspace <span className="cl-muted">/</span> <b>{view}</b></span><div className="cl-inline"><span className={`cl-dot ${online ? 'online' : ''}`} />{online ? 'Local chain connected' : 'Disconnected'}<label className="cl-account">Test account<select value={role} onChange={e => setRole(e.target.value as Role)} disabled={busy || !!modal}>{['Organizer', 'Verifier', 'Donor'].map(r => <option key={r}>{r}</option>)}</select></label></div></header>
      <main className="cl-content">
        {data && <div className="cl-connection"><span title={data.contractAddress}>Contract <code>{short(data.contractAddress)}</code></span><span>Block {data.block}</span><span title={signer?.address}>{role} <code>{short(signer?.address)}</code> · {eth(signer?.balance)} local ETH</span><span>Chain 31337</span><button className="cl-link" onClick={() => void refresh()} disabled={busy}><RefreshCw size={13} /> Refresh</button></div>}
        {(notice || storageError) && <div className="cl-alert" role="alert"><AlertTriangle size={20} /><span>{storageError || notice} {!online && 'Start the local node and run npm.cmd run app:local. Last loaded values may be stale.'}</span></div>}
        {active && <section className={`cl-transaction ${active.status === 'confirmed' ? 'success' : ''}`} aria-label="Transaction recovery" aria-live="polite">
          <div className="cl-row"><h2>{active.status === 'confirmed' ? <CircleCheck size={21} /> : <History size={21} />} Transaction {active.status.replaceAll('_', ' ')}</h2><span className="cl-badge">{active.action.kind}</span></div>
          <p>{active.message}</p><small>Saved request</small><code className="cl-hash">{active.id}</code>
          {active.hash && <><small>Transaction hash{active.blockNumber !== undefined ? ` · block ${active.blockNumber}` : ''}</small><code className="cl-hash">{active.hash}</code></>}
          <div className="cl-actions"><button className="cl-btn secondary" onClick={() => void recover('check')} disabled={busy}>Check status</button>
            {active.hash && !terminal.has(active.status) && <button className="cl-btn" onClick={() => void recover('resend')} disabled={busy || !online}>Resend same transaction</button>}
            {active.status === 'not_found' && <button className="cl-btn" onClick={() => envelope.current && void send(envelope.current)} disabled={busy || !online}>Submit same saved request</button>}
            {terminal.has(active.status) && <button className="cl-btn secondary" onClick={dismiss} disabled={busy}>Dismiss</button>}
          </div><small>{terminal.has(active.status) ? 'You can open the next action after correcting any reported cause.' : 'An unavailable receipt does not prove failure. Recovery preserves the original request and transaction.'}</small>
        </section>}
        {!active && pending && <div className="cl-alert">A saved transaction needs checking.<button className="cl-btn secondary" onClick={() => void recover('check', pending)}>Recover request</button></div>}
        <div className="cl-heading"><div><p className="cl-eyebrow">{campaign ? `CAMPAIGN ${campaign.id}` : 'THE BIG PICTURE'}</p><h1>{campaign?.title || (view === 'Overview' ? 'Good intentions. Visible impact.' : view)}</h1><p className="cl-muted">Track the funding. See the proof. Follow the progress.</p></div><button className="cl-btn" disabled={blocked} onClick={() => { setRole('Organizer'); open('create'); }}><Plus size={18} /> Create campaign</button></div>
        {view === 'Overview' && !campaign && <div className="cl-stats">{[['Total raised', data?.totalRaised], ['Funds released', data?.totalReleased], ['Held in escrow', data?.escrow], ['Awaiting review', String(needsReview.length)]].map(([title, value], i) => <div className="cl-card" key={title}><span>{title}</span><strong>{data ? eth(value) : '—'}</strong><small>{i === 3 ? 'milestone evidence' : 'local ETH'}</small></div>)}</div>}
        {campaign ? <>
          <button className="cl-link" onClick={() => setSelected(null)}><ArrowLeft size={16} /> Back to campaigns</button>
          <section className="cl-card cl-detail"><div className="cl-row"><div><span className="cl-muted">{campaign.location}</span><p>{campaign.description || 'Campaign metadata is unavailable in this local journal.'}</p></div><span className="cl-badge">{campaign.complete ? 'Complete' : 'Active'}</span></div>
            <div className="cl-stats mini"><div><strong>{eth(campaign.raised)} / {eth(campaign.goal)}</strong><small>local ETH funded</small></div><div><strong>{eth(campaign.available)}</strong><small>local ETH available</small></div><div><strong>{eth(campaign.released)}</strong><small>local ETH released</small></div></div>
            <progress max="100" value={progress(campaign)} aria-label="Campaign funding" />
            <div className="cl-addresses">{(['organizer', 'verifier', 'recipient'] as const).map(r => <div key={r}><small>{r}</small><code>{campaign[r]}</code></div>)}</div>
            <button className="cl-btn" disabled={blocked || BigInt(campaign.raisedWei) >= BigInt(campaign.goalWei)} onClick={() => { setRole('Donor'); open('contribute', campaign); }}>Contribute local ETH</button>
          </section>
          <h2 className="cl-section-title">Three milestones. A visible trail.</h2>
          {campaign.milestones.map(m => <section className="cl-card cl-milestone" key={m.id}><div className="cl-row"><h3><span className="cl-step">{m.id + 1}</span>{m.title}</h3><span className={`cl-badge ${m.status}`}>{m.status}</span></div><p><b>{eth(m.amount)} local ETH</b> · Evidence revision {m.revision}</p>
            {m.evidence && <div className="cl-evidence"><small>Saved evidence bytes match the on-chain fingerprint</small><p>{m.evidence}</p><code className="cl-hash">{m.evidenceHash}</code></div>}
            {!m.evidence && m.status !== 'planned' && <p className="cl-warning">Evidence text is unavailable locally. A hash alone does not establish what was delivered.</p>}
            {m.review && <div className="cl-evidence"><small>Verifier note</small><p>{m.review}</p><code className="cl-hash">{m.reviewHash}</code></div>}
            {m.id !== campaign.nextMilestone && m.status !== 'released' && <small>Locked until the preceding milestone is released.</small>}
            {m.id === campaign.nextMilestone && <div className="cl-actions">
              {['planned', 'rejected'].includes(m.status) && <button className="cl-btn" disabled={blocked || signer?.address.toLowerCase() !== campaign.organizer.toLowerCase()} onClick={() => open('evidence', campaign, m)}>{m.status === 'rejected' ? 'Revise evidence' : 'Submit evidence'}</button>}
              {m.status === 'pending' && <button className="cl-btn" disabled={blocked || !m.evidence || signer?.address.toLowerCase() !== campaign.verifier.toLowerCase()} onClick={() => open('review', campaign, m)}>Review evidence</button>}
              {m.status === 'approved' && <><button className="cl-btn" disabled={blocked || signer?.address.toLowerCase() !== campaign.organizer.toLowerCase() || BigInt(campaign.availableWei) < BigInt(m.amountWei)} onClick={() => open('release', campaign, m)}>Release milestone</button>{BigInt(campaign.availableWei) < BigInt(m.amountWei) && <small>Add funding before release.</small>}</>}
              <small>{m.status === 'pending' ? 'Select the Verifier test account to review.' : m.status !== 'released' ? 'Select the Organizer test account for this action.' : ''}</small>
            </div>}
          </section>)}
        </> : view === 'Overview' || view === 'Campaigns' ? <>
          <div className="cl-row cl-section-title"><h2>Active campaigns <span className="cl-badge">{data?.campaigns.length || 0}</span></h2><input className="cl-search" aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={e => setSearch(e.target.value)} /></div>
          {campaignCards.length ? <div className="cl-grid">{campaignCards.map(c => <button className="cl-card cl-campaign" key={c.id} onClick={() => setSelected(c.id)}><div className="cl-row"><FolderHeart size={25} /><span className="cl-badge">{c.complete ? 'Complete' : c.milestones.some(m => m.status === 'pending') ? 'In review' : 'Active campaign'}</span></div><h3>{c.title}</h3><p>{c.location}</p><div className="cl-row"><strong>{eth(c.raised)} <small>local ETH</small></strong><span>{progress(c)}%</span></div><progress value={progress(c)} max="100" aria-label={`${c.title} funding`} /><small>of {eth(c.goal)} local ETH goal</small><div className="cl-card-foot"><ShieldCheck size={16} />{c.milestones.filter(m => m.status === 'released').length}/3 milestones released<ArrowUpRight size={18} /></div></button>)}</div> : <section className="cl-card cl-empty"><FolderHeart size={36} /><h2>{search ? 'No matching campaigns' : 'Your local ledger starts here.'}</h2><p>{search ? 'Try another title or location.' : 'Create a campaign with three milestone budgets. The browser demo’s sample balances are separate from this blockchain.'}</p></section>}
        </> : view === 'Verification' ? <div className="cl-grid">{needsReview.length ? needsReview.map(({ c, m }) => <section className="cl-card" key={`${c.id}-${m.id}`}><span className="cl-badge pending">Awaiting independent review</span><h3>{m.title}</h3><p>{c.title} · Revision {m.revision}</p><p className="cl-evidence">{m.evidence || 'Evidence bytes unavailable. Restore the local journal to review.'}</p><button className="cl-btn" disabled={blocked || !m.evidence} onClick={() => { setRole('Verifier'); open('review', c, m); }}>Review evidence</button></section>) : <section className="cl-card cl-empty"><ShieldCheck size={32} /><h2>No pending reviews</h2><p>Submit evidence as the organizer to start an independent review.</p></section>}</div> : <section className="cl-card"><h2>On-chain proof history</h2><p className="cl-muted">Latest 150 events within 10,000 blocks. Hashes prove which bytes were committed, not whether a claim is true.</p>{data?.events.length ? data.events.map(e => <div className="cl-history" key={e.id}><div className="cl-row"><b>{e.name.replace(/([a-z])([A-Z])/g, '$1 $2')}</b><span>Block {e.block}</span></div><small>Campaign {e.campaignId}{e.amount !== null ? ` · ${eth(e.amount)} local ETH` : ''}</small><code className="cl-hash">{e.hash}</code></div>) : <p>No events recorded yet.</p>}</section>}
        <section className="cl-card cl-recent"><h2>Transaction recovery journal</h2><p className="cl-muted">Saved by the local service before broadcast. Refreshing this page or restarting the app does not create another transaction.</p>{data?.requests.length ? data.requests.map(r => <div className="cl-history" key={r.id}><div className="cl-row"><span><b>{r.action.kind}</b> · {r.action.role} <span className="cl-badge">{r.status.replaceAll('_', ' ')}</span></span><button className="cl-link" disabled={busy} onClick={() => void recover('check', r)}>Inspect</button></div><code className="cl-hash">{r.hash || r.id}</code></div>) : <p>No requests saved yet.</p>}
          <details><summary>Test a lost submission response</summary><p>The service submits and saves the transaction, then drops its HTTP reply. Check its saved identifier to recover the outcome.</p><label className="cl-check"><input type="checkbox" checked={loseResponse} onChange={e => setLoseResponse(e.target.checked)} disabled={blocked} /> Lose the next submission response</label></details>
        </section>
        <footer className="cl-footer">AidLedger · Transparent aid, one milestone at a time.<span>Keep the Hardhat node running. Restarting it resets chain state.</span></footer>
      </main>
    </div>
    <Dialog open={!!modal} onOpenChange={value => { if (!value && !busy) setModal(null); }}><DialogContent className="cl-dialog"><DialogHeader><DialogTitle>{{ create: 'Create a campaign', contribute: 'Fund this campaign', evidence: 'Submit milestone evidence', review: 'Review the exact evidence', release: 'Confirm milestone release' }[modal?.kind || 'create']}</DialogTitle><DialogDescription>Signed by the {role} public local test account. Amounts are valueless local ETH.</DialogDescription></DialogHeader>
      <form onSubmit={submitForm} className="cl-form">
        {modal?.kind === 'create' && <><label>Campaign title<input name="title" required minLength={3} maxLength={80} placeholder="Clean water for Uselu" /></label><label>Location<input name="location" required minLength={2} maxLength={80} placeholder="Uselu, Edo State" /></label><label>What will this campaign deliver?<textarea name="description" required minLength={10} maxLength={800} /></label>{['Purchase supplies', 'Deliver support', 'Final handover'].map((title, i) => <div className="cl-form-row" key={i}><label>Milestone {i + 1}<input name={`title${i}`} defaultValue={title} required minLength={3} maxLength={100} /></label><label>Budget (local ETH)<input name={`amount${i}`} defaultValue={String(i + 1)} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,18})?" /></label></div>)}<small>The recipient and verifier are fixed to their separate deployment accounts.</small></>}
        {modal?.kind === 'contribute' && <><p>{modal.campaign?.title} · {eth(modal.campaign?.raised)} of {eth(modal.campaign?.goal)} local ETH funded</p><label>Contribution (local ETH)<input name="amount" defaultValue="1" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,18})?" /></label></>}
        {modal?.kind === 'evidence' && <><h3>{modal.milestone?.title}</h3><label>Evidence description<textarea name="text" required minLength={10} maxLength={1500} placeholder="Describe the delivery and supporting evidence for this local prototype." /></label><small>The exact JSON bytes are saved locally and their fingerprint is committed on-chain. Use fictional demonstration data.</small></>}
        {modal?.kind === 'review' && <><h3>{modal.milestone?.title}</h3><p className="cl-evidence">{modal.milestone?.evidence}</p><small>Revision {modal.milestone?.revision} · review binds to this fingerprint</small><code className="cl-hash">{modal.milestone?.evidenceHash}</code><label>Decision<select name="decision"><option value="approve">Approve evidence</option><option value="reject">Request revised evidence</option></select></label><label>Reason for this decision<textarea name="text" required minLength={10} maxLength={600} /></label></>}
        {modal?.kind === 'release' && <><p>Release exactly <b>{eth(modal.milestone?.amount)} local ETH</b> for <b>{modal.milestone?.title}</b>.</p><small>Fixed recipient</small><code className="cl-hash">{modal.campaign?.recipient}</code><p>The contract checks approval, order, and available funding before transferring the milestone budget.</p></>}
        <div className="cl-actions"><button type="button" className="cl-btn secondary" onClick={() => setModal(null)}>Cancel</button><button className="cl-btn" type="submit" disabled={blocked}>Confirm {modal?.kind === 'release' ? 'release' : 'transaction'}</button></div>
      </form>
    </DialogContent></Dialog>
  </div>;
}
