# AidLedger local blockchain integration

This update connects your existing local AidLedger frontend to the AidLedger contract on Hardhat chain 31337. It includes campaign creation, funding, evidence submission, independent review, release, transaction progress, and restart recovery. The pale green information banner is removed. The original browser demo remains at `/browser-demo`.

## Install on your Windows project

Your existing contract and frontend dependencies must already be installed. This update adds no dependencies. It uses the native Next.js startup command that worked on your laptop.

1. Keep the terminal running `npm.cmd run node` open. If it is no longer running, start it from the contracts folder, then run `npm.cmd run deploy:local` in another terminal. Deploy only when needed: each deployment is a new contract with no campaigns.
2. Stop the old frontend server with Ctrl+C in its terminal. Do not stop the Hardhat node.
3. Download `AidLedger-Local-Integration.zip` to Downloads. Paste this block into PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $project = Join-Path $env:USERPROFILE 'Projects\AidLedger-20260921-211543\AidLedger-Local-Contracts'
    $zip = Join-Path $env:USERPROFILE 'Downloads\AidLedger-Local-Integration.zip'
    $extract = Join-Path $env:USERPROFILE ('Downloads\AidLedger-Update-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Expand-Archive -LiteralPath $zip -DestinationPath $extract
    node (Join-Path $extract 'AidLedger-Local-Integration\install.mjs') $project
    if ($LASTEXITCODE -ne 0) { throw 'Installation stopped. Share the error above.' }
    Set-Location $project
    npm.cmd run app:local
}
```

4. When Next.js reports Ready, open **http://127.0.0.1:5173**. Use this exact address, rather than localhost, because local origin checks are enforced.

The installer backs up every file it replaces to `backups/local-integration-TIMESTAMP/`. It preserves your Solidity contract, installed packages, lockfiles, deployment file, and recovery journal. It does not publish anything to the hosted demo. It adds `app:local` and `test:integration` scripts to the root package.json.

If your download has a different filename or your project folder moved, adjust the two paths above. If you already extracted the ZIP, run `node "PATH-TO-EXTRACTED-FOLDER\install.mjs" "PATH-TO-AidLedger-Local-Contracts"`, then run `npm.cmd run app:local` from the contracts folder.

## First connected campaign

The contract currently has zero campaigns; that is expected. Your old demo credits are not on-chain and are not imported.

1. Select Create campaign. Supply a title, location, description and three milestones; default budgets are 1, 2 and 3 local ETH.
2. Wait for Transaction confirmed, then open the campaign.
3. Choose Contribute local ETH. This selects the Donor account. Contribute 6 local ETH to fully fund the campaign, or 2.5 to demonstrate insufficient funding later.
4. Select Organizer at the top. Submit evidence for milestone 1.
5. Select Verifier. Review that exact evidence revision and record a reason to approve or reject it.
6. Select Organizer. Confirm the milestone release. Only the approved budget goes to the fixed recipient.
7. Repeat for milestones 2 and 3. With full funding, the end result is 6 raised, 6 released, 0 in escrow.

Approving alone does not transfer funds. Later milestones remain locked until the previous release. Rejected evidence can be revised. Reviews bind to both the fingerprint and revision, so an old review cannot approve changed evidence.

The selected role is an actual separate default local signer. The contract still enforces its addresses. This prototype uses the publicly known Hardhat test accounts through a loopback-only service; it does not request a personal wallet or key.

## Recovery demonstration

In Transaction recovery journal, expand Test a lost submission response and check Lose the next submission response. Create a campaign or perform another allowed action. The service saves and submits the transaction but drops the HTTP reply. Automatic refresh or Check status recovers the result by the saved request identifier. No second action is created.

Other states:

| State | Meaning | Next step |
| --- | --- | --- |
| Preparing | Browser request saved; transaction being prepared | Wait |
| Pending | Transaction known, not yet mined | Check status |
| Unknown | Connection or receipt unavailable | Check status; if offered, resend the same signed transaction |
| Not found | Service has no record of this browser request | Submit the same saved request identifier |
| Confirmed | Receipt succeeded | Continue with the next action |
| Not sent | Input/preflight rejected before broadcast | Correct the cause and submit a new action |
| Reverted | Mined receipt failed | Inspect state, correct the cause, then use a new action |
| Replaced | Another transaction consumed the nonce | Inspect state before deciding whether another action is needed |
| Node reset | Request belongs to an older local chain/deployment | Start a new campaign on the current deployment; old request cannot be replayed |

Refreshing the browser or stopping/restarting `app:local` preserves recovery as long as you keep the same Hardhat node and the journal. Browser localStorage holds the request envelope; `deployments/ui-journal.json` holds the exact signed transactions, hashes, evidence bytes, reviews and metadata. Keep that file intact. The journal appears in the dashboard even if browser storage was cleared.

**Hardhat blockchain state remains in memory.** Keeping the node running makes it independent of the dashboard process; stopping it still resets the chain. This update does not add disk-backed blockchain persistence. After a node restart, run `deploy:local` and refresh the dashboard. The app identifies the new node session and archives previous requests rather than replaying them. The old journal does not restore lost chain state.

A test transaction normally mines quickly. Automated integration tests explicitly disable automining to verify pending and mined-failure behavior.

## Validation commands

From AidLedger-Local-Contracts:

```powershell
npm.cmd run test:integration
npm.cmd test
npm.cmd run inspect:local
```

The integration tests run their own temporary simulated chain and temporary journal. They do not seed or mutate your running dashboard deployment.

## What is stored and verified

- Campaigns, budgets, balances, approvals, revisions and release rules: Solidity contract.
- Exact evidence and review JSON bytes: local journal, with keccak256 fingerprint committed to the contract.
- Campaign descriptions and locations: journal metadata bound to the campaign metadata hash.
- Signed request bytes and hashes: journal, written before broadcasting.
- Current request identifier: browser storage, written before the HTTP submission.

A hash verifies the bytes that were committed. It does not independently verify delivery or the truth of a claim. Lost metadata or evidence bytes cannot be reconstructed from the hash.

## Scope and limits

This is a local, single-user development demo. The service binds to 127.0.0.1:8787 and talks only to 127.0.0.1:8545. The frontend runs on 127.0.0.1:5173. No cloud deployment, public network integration, production wallet connection, decentralized evidence storage, refund/cancellation flow or verifier replacement is included. Use one active dashboard tab during the demo. The service allows one unresolved request at a time, up to 30 campaigns and 500 journal requests. Proof history shows the most recent 150 events within 10,000 blocks; the UI journal shows the latest 30 requests.

## Troubleshooting and rollback

- Port 5173 in use: stop your old frontend terminal with Ctrl+C. Start only `app:local`, not an additional `npm run dev`.
- Connection unavailable: keep the Hardhat terminal open; inspect the deployment with `npm.cmd run inspect:local`.
- Account/contract mismatch: this update expects the supplied default Hardhat config and current compiled AidLedger bytecode.
- Storage warning: preserve browser data and `deployments/ui-journal.json`; do not clear a pending request to force another submission.
- Damaged journal: preserve the file and restore a known-good backup. Do not delete it to bypass recovery.
- To roll back UI changes: stop `app:local`, restore overwritten files from the timestamped backup (including root package.json and .gitignore), and remove files listed in backup-manifest.json under changed that were not listed under existed. Keep deployments and ui-journal.json. Then use your previous frontend startup command.
