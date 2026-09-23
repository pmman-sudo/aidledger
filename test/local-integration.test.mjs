import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { simulation, accounts, deploy, artifact } from '../scripts/runtime.mjs';
import { LocalLedger } from '../scripts/local-ledger.mjs';
import { createLocalServer } from '../scripts/local-server.mjs';

async function fixture(t) {
  const sim = await simulation();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidledger-integration-'));
  t.after(async () => { await sim.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actors = await accounts(sim.provider);
  const contract = await deploy(sim.provider, actors.organizer);
  const receipt = await contract.deploymentTransaction().wait();
  fs.mkdirSync(path.join(root, 'artifacts')); fs.mkdirSync(path.join(root, 'deployments'));
  fs.writeFileSync(path.join(root, 'artifacts/AidLedger.json'), JSON.stringify(await artifact()));
  const deployment = { chainId: 31337, contractAddress: await contract.getAddress(), transactionHash: receipt.hash, deploymentBlock: receipt.blockNumber,
    accounts: Object.fromEntries(await Promise.all(Object.entries(actors).map(async ([k,v]) => [k, await v.getAddress()]))) };
  fs.writeFileSync(path.join(root, 'deployments/localhost.json'), JSON.stringify(deployment));
  const ledger = new LocalLedger({ root, provider: sim.provider });
  const session = (await ledger.snapshot()).session;
  const input = action => ({ id: randomUUID(), session, action });
  const submit = action => ledger.submit(input(action));
  return { ...sim, root, actors, contract, ledger, session, input, submit };
}
const create = { kind: 'create', role: 'Organizer', title: 'Clean water for Uselu', description: 'A local demonstration of aid delivery.', location: 'Uselu, Edo State',
  milestones: ['Purchase supplies', 'Deliver support', 'Final handover'].map((title,i) => ({ title, amount: String(i+1) })) };
const contribution = amount => ({kind:'contribute',role:'Donor',campaignId:'0',amount});
const evidence = (milestoneId=0) => ({kind:'evidence',role:'Organizer',campaignId:'0',milestoneId,text:'Fictional delivery evidence checked against the planned milestone.'});
const review = (m, approve=true, role='Verifier') => ({kind:'review',role,campaignId:'0',milestoneId:m.id,revision:m.revision,evidenceHash:m.evidenceHash,text:'I checked this exact evidence revision and recorded my decision.',approve});
const release = (milestoneId=0) => ({kind:'release',role:'Organizer',campaignId:'0',milestoneId});

test('integrated create, funding, exact review and all releases conserve 6 local ETH', async t => {
  const f = await fixture(t);
  assert.equal((await f.submit(create)).status, 'confirmed');
  assert.equal((await f.submit(contribution('6'))).status, 'confirmed');
  for (let i=0;i<3;i++) {
    assert.equal((await f.submit(evidence(i))).status, 'confirmed');
    const m = (await f.ledger.snapshot()).campaigns[0].milestones[i];
    assert.ok(m.evidence.includes('Fictional'));
    assert.equal((await f.submit(review(m))).status, 'confirmed');
    assert.equal((await f.submit(release(i))).status, 'confirmed');
  }
  const final = await f.ledger.snapshot();
  assert.equal(final.totalRaised, '6.0'); assert.equal(final.totalReleased, '6.0'); assert.equal(final.escrow, '0.0');
  assert.equal(final.campaigns[0].complete, true); assert.ok(final.events.length >= 11);
});

test('reusing a request identifier after a response loss or app restart never creates another campaign', async t => {
  const f = await fixture(t); const input = f.input(create);
  const first = await f.ledger.submit(input);
  const restarted = new LocalLedger({ root:f.root, provider:f.provider });
  const recovered = await restarted.submit(input);
  assert.equal(first.hash, recovered.hash); assert.equal(recovered.status,'confirmed');
  assert.equal(await f.contract.campaignCount(),1n);
  assert.equal((await restarted.resend(input.id)).hash,first.hash);
  assert.equal(await f.contract.campaignCount(),1n);
  await assert.rejects(restarted.submit({...input, action:{...create,title:'Changed details'}}), /different details/);
});

test('an interrupted pre-broadcast request is recovered by resending the saved signed bytes once', async t => {
  const f = await fixture(t); let drop = true;
  const provider = new Proxy(f.provider, {get(target,key){ if(key==='send')return async(method,args)=>{if(drop&&method==='eth_sendRawTransaction')throw Error('Socket reset before broadcast');return target.send(method,args);}; const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const ledger = new LocalLedger({root:f.root,provider}); const input=f.input(create);
  const result = await ledger.submit(input);
  assert.equal(result.status,'unknown'); assert.ok(result.hash); assert.equal(await f.contract.campaignCount(),0n);
  await assert.rejects(ledger.submit(f.input(create)),/Resolve request/);
  drop=false;
  const recovered=await ledger.resend(input.id);
  assert.equal(recovered.status,'confirmed'); assert.equal(recovered.hash,result.hash);
  assert.equal(await f.contract.campaignCount(),1n);
});

test('loss of the RPC reply after mining is reconciled against the original hash',async t=>{
  const f=await fixture(t);
  const provider=new Proxy(f.provider,{get(target,key){if(key==='send')return async(method,args)=>{const value=await target.send(method,args);if(method==='eth_sendRawTransaction')throw Error('Lost RPC reply');return value;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const ledger=new LocalLedger({root:f.root,provider});
  const result=await ledger.submit(f.input(create));
  assert.equal(result.status,'confirmed'); assert.equal(await f.contract.campaignCount(),1n);
});

test('permission failures are not sent, stale reviews fail, revised evidence can be approved',async t=>{
  const f=await fixture(t); await f.submit(create); await f.submit(evidence());
  const old=(await f.ledger.snapshot()).campaigns[0].milestones[0];
  const unauthorized=await f.submit(review(old,true,'Organizer'));
  assert.equal(unauthorized.status,'not_sent'); assert.equal(unauthorized.hash,undefined);
  assert.match(unauthorized.message,/VerifierOnly/);
  assert.equal((await f.submit(review(old,false))).status,'confirmed');
  await f.submit({...evidence(),text:'Revised fictional evidence containing the requested delivery details.'});
  assert.equal((await f.submit(review(old))).status,'not_sent');
  const revised=(await f.ledger.snapshot()).campaigns[0].milestones[0];
  assert.equal(revised.revision,'2'); assert.equal((await f.submit(review(revised))).status,'confirmed');
  assert.equal((await f.submit(release())).status,'not_sent');
  await f.submit(contribution('1'));
  assert.equal((await f.submit(release())).status,'confirmed');
});

test('a new node session archives old requests and blocks replay',async t=>{
  const f=await fixture(t);const input=f.input(create);const result=await f.ledger.submit(input);
  const provider=new Proxy(f.provider,{get(target,key){if(key==='send')return async(method,args)=>{const value=await target.send(method,args);return method==='hardhat_metadata'?{...value,instanceId:'0x'+'ab'.repeat(32)}:value;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const ledger=new LocalLedger({root:f.root,provider});
  assert.equal((await ledger.resend(input.id)).status,'node_reset');
  assert.equal((await ledger.snapshot()).requests[0].status,'node_reset');
  assert.equal(await f.contract.campaignCount(),1n);
  await assert.rejects(ledger.submit(f.input(create)),/node changed/);
  assert.ok(result.hash);
});

test('HTTP service rejects foreign writes and recovers a deliberately lost HTTP reply',async t=>{
  const f=await fixture(t);const app=createLocalServer({root:f.root,provider:f.provider});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}/api`;
  const input=f.input(create);
  const headers={'Content-Type':'application/json','x-aidledger-local':'1','Origin':'http://127.0.0.1:5173'};
  assert.equal((await fetch(url+'/requests',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(url+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);
  await assert.rejects(fetch(url+'/requests',{method:'POST',headers,body:JSON.stringify({...input,loseResponse:true})}));
  const recovered=await (await fetch(url+'/requests/'+input.id)).json();
  assert.equal(recovered.status,'confirmed');assert.equal(await f.contract.campaignCount(),1n);
  assert.equal((await (await fetch(url+'/requests',{method:'POST',headers,body:JSON.stringify(input)})).json()).hash,recovered.hash);
});

test('damaged evidence journal is detected instead of approving changed bytes',async t=>{
  const f=await fixture(t);await f.submit(create);
  const file=path.join(f.root,'deployments/ui-journal.json');const journal=JSON.parse(fs.readFileSync(file,'utf8'));
  journal.documents[Object.keys(journal.documents)[0]]='changed';fs.writeFileSync(file,JSON.stringify(journal));
  assert.throws(()=>new LocalLedger({root:f.root,provider:f.provider}),/evidence document has changed/);
});

test('pending transactions survive an app restart and only confirm after a block is mined',async t=>{
  const f=await fixture(t);
  await f.provider.send('evm_setAutomine',[false]);
  t.after(()=>f.provider.send('evm_setAutomine',[true]).catch(()=>{}));
  const input=f.input(create);const submitted=await f.ledger.submit(input);
  assert.equal(submitted.status,'pending');
  const restarted=new LocalLedger({root:f.root,provider:f.provider});
  assert.equal((await restarted.check(input.id)).status,'pending');
  await f.provider.send('evm_mine',[]);
  const result=await restarted.check(input.id);
  assert.equal(result.status,'confirmed');assert.equal(result.hash,submitted.hash);
});

test('a transaction that reverts when mined is reported as a confirmed failure',async t=>{
  const f=await fixture(t);await f.submit(create);
  await f.provider.send('evm_setAutomine',[false]);
  t.after(()=>f.provider.send('evm_setAutomine',[true]).catch(()=>{}));
  const submitted=await f.submit(contribution('6'));
  assert.equal(submitted.status,'pending');
  // Another donor fills the campaign first, after preflight but before mining.
  await f.contract.connect(f.actors.donorTwo).contribute(0,{value:6n*10n**18n,gasPrice:100000000000n,gasLimit:200000n});
  await f.provider.send('evm_mine',[]);
  const checked=await f.ledger.check(submitted.id);
  assert.equal(checked.status,'reverted');assert.equal((await f.ledger.snapshot()).totalRaised,'6.0');
});
