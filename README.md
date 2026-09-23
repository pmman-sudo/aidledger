# AidLedger — local smart-contract milestone

A runnable educational Solidity project that moves AidLedger's funding and milestone rules into a local Ethereum simulation. It uses valueless test currency, fictional evidence, and separate local accounts. No wallet extension, personal wallet, API key, external blockchain account, or paid service is needed.

**This package is the contract milestone. The existing hosted AidLedger dashboard still uses its browser demo and has not been connected to this contract.**

## Start here on Windows

1. Extract the ZIP to a new folder. Keep this package separate from any existing frontend.
2. Open the extracted folder that contains `package.json` in VS Code.
3. Choose **Terminal → New Terminal** and use PowerShell.
4. Check that Node.js is version 24, then run:

```powershell
node --version
npm.cmd ci
npm.cmd test
npm.cmd run demo
```

On macOS/Linux, use `npm` instead of `npm.cmd`.

The first install needs an internet connection to download the locked npm dependencies. After installation, compilation, tests, and the temporary demo run locally. The compiler is an npm dependency; compilation does not need a separate Solidity compiler download.

`npm.cmd` avoids the common Windows issue where PowerShell blocks `npm.ps1`. No execution-policy change is required.

### What success looks like

The tests finish with **28 passed, 0 failed**. The demo finishes with:

```text
COMPLETE: 6 local ETH contributed, 6 released, 0 remaining; all 3 milestones released.
Report: reports/demo-result.json
```

The demo intentionally prints `BLOCKED` for four disallowed actions. These are successful demonstrations of the contract rules, not failures you need to fix.

The test suite and demo each create temporary local chains. They do not need a separately running node and do not change the hosted dashboard. The temporary chain disappears when the command finishes; the report remains on disk.

## What is implemented

| Action | Contract behavior |
| --- | --- |
| Create campaign | Fixes an organizer, verifier, recipient, three titles, and three positive budgets. |
| Contribute | Records the donor and value; rejects zero contributions and funding above the goal. |
| Submit evidence | Only that campaign's organizer can submit for its next available milestone. |
| Review evidence | Only its designated verifier can approve or reject the exact revision and fingerprint submitted. |
| Resubmit | Rejected evidence can be replaced; its revision increases and its review fingerprint is cleared. |
| Release | Only the organizer can release an approved milestone with sufficient campaign funds. |
| Record activity | Emits events for campaign creation, contributions, evidence, decisions, and releases. |

The verifier must have an address different from the organizer and recipient. Anyone may contribute, including an organizer or verifier; donor is an action, not a global permission.

Releases always go to the recipient fixed at creation. There is no function that changes a recipient, verifier, or milestone budget after creation. A release cannot spend another campaign's escrow or release the same milestone twice. If the recipient refuses a transfer, the transaction reverts and the milestone remains approved for a later retry.

## What you are learning

The interface previously checked rules in JavaScript. In this project, Solidity checks the transaction sender and on-chain campaign state. Changing a role label in an interface cannot bypass the contract's checks.

The workflow is:

1. An organizer creates a campaign with budgets **1 + 2 + 3 local ETH**.
2. A donor contributes **2.5 local ETH**.
3. The organizer submits a fingerprint of the first fictional evidence file.
4. A different account approves that evidence.
5. The organizer releases **1 local ETH** to the fixed recipient.
6. The second milestone is approved, but its **2 local ETH** release is blocked while only **1.5** is available.
7. The donor adds the remaining **3.5**, and the final two milestones can be released.
8. The result is **6 contributed, 6 released, 0 remaining**.

## Keep a local node running for the next integration stage

This is optional for now. It creates a node on your own computer that survives between commands while its terminal remains open.

In Terminal 1, from this package's folder:

```powershell
npm.cmd run node
```

Keep that terminal open. In Terminal 2, from the same folder:

```powershell
npm.cmd run deploy:local
npm.cmd run inspect:local
```

The node listens only at `http://127.0.0.1:8545` on chain ID `31337`. The deployment script checks the chain ID and Hardhat client, then saves `deployments/localhost.json` with the contract address, ABI, and local account addresses. It creates an empty contract; it does not seed campaigns. Re-running deployment reuses matching code on that node.

`npm run demo` uses a different, temporary chain. Its demo campaigns will **not** appear in `inspect:local`.

The Hardhat node prints disposable public development accounts. This project uses them directly through the local provider; you do not need to copy any private keys. Their balances have no monetary value.

Stop Terminal 1 with **Ctrl+C** when finished. Restarting the node resets its chain; run `deploy:local` again afterward. Stored report transaction hashes are not public-chain explorer links.

## Files worth reading

| File | Purpose |
| --- | --- |
| `contracts/AidLedger.sol` | The contract and its permission, approval, balance, and release rules. |
| `contracts/test/RecipientHarness.sol` | A test-only recipient used to check failed transfers and callbacks. |
| `test/aidledger.test.mjs` | 28 tests against actual compiled Solidity in the local EVM. |
| `scripts/compile.mjs` | Rebuilds artifacts with the exact pinned Solidity compiler. |
| `scripts/demo.mjs` | Runs the full workflow and writes a transaction report. |
| `scripts/deploy-local.mjs` | Deploys to the node on your own computer. |
| `scripts/inspect-local.mjs` | Reads the persistent local deployment. |
| `samples/` | Fictional campaign, evidence, and review documents. |
| `artifacts/AidLedger.json` | Generated ABI and bytecode; rebuild after changing Solidity. |
| `docs/CONTRACT-INTERFACE.md` | Function, event, status, and amount mappings for later UI integration. |
| `docs/VALIDATION.md` | What was run and what has not been established. |

## Boundaries of this version

- Educational and unaudited; it is not a real-money donation service. Deployment is restricted in the constructor to chain ID 31337, and all provided scripts target local simulations.
- This uses native local ETH, not USDT, a stablecoin, or the hosted dashboard's fictional credits.
- A distinct verifier address does not prove a distinct person or a trustworthy organization. The organizer currently chooses that verifier.
- Fingerprints demonstrate which bytes were referenced, not that a statement is true. Full evidence remains in files outside the contract; there is no hosted evidence store or upload service.
- There is no campaign cancellation, refund, deadline, verifier replacement, or dispute resolution. Incomplete or abandoned campaigns can leave local test funds locked. Those policies require a separate design milestone.
- No real personal, patient, or sensitive information should be put in the sample files or public event data.
- Checks-effects-interactions and a reentrancy guard are included and tested, but passing tests is not a security audit.
- The contract rejects ordinary direct transfers. Forced/unattributed native currency is not credited to any campaign; release accounting uses recorded campaign contributions.

## Troubleshooting

**`package.json` not found:** the terminal is in the wrong folder. Run `Get-ChildItem` and open the folder containing this README and `package.json`.

**Wrong Node version:** use Node.js 24 for this package. It was tested with Node.js 24.19.0.

**`npm.ps1 cannot be loaded`:** use the `npm.cmd` commands above.

**Download timeout / `ECONNRESET`:** restore connectivity and rerun `npm.cmd ci`. Keep `package-lock.json` so the same dependency versions are installed.

**Port 8545 already in use:** a local node may already be running. Check the terminal where you started it. Do not stop unrelated programs or expose the node on a public interface.

**Local node unavailable:** start `npm.cmd run node` in another terminal before `deploy:local` or `inspect:local`. Tests and `demo` need no separate node.

**Zero campaigns after deployment:** expected. The deployment command creates an empty contract; the demo uses its own temporary chain.

## References

- [Hardhat network management](https://hardhat.org/docs/explanations/network-management): independent simulated networks and connection lifecycle.
- [Hardhat configuration](https://hardhat.org/docs/reference/configuration): local network settings.
- [Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html): checks-effects-interactions, external calls, and transfer behavior.

Dependency versions are pinned in `package.json` and `package-lock.json`: Hardhat 3.17.0, ethers 6.17.0, and solc 0.8.37.
