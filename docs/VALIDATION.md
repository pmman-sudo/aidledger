# Validation record

## Environment

- Node.js 24.19.0 on Linux
- npm 11.9.0
- Hardhat 3.17.0; ethers 6.17.0; solc 0.8.37
- Solidity optimizer: 200 runs; EVM target: Cancun
- Local chain ID: 31337

## Completed checks

`npm test`: **28 passed, 0 failed** against compiled Solidity executed by Hardhat's local EVM. These are not mocks of the original JavaScript reducer.

The suite covers:

- Fixed campaign roles, budgets, and metadata validation.
- Invalid IDs, zero addresses, zero contributions, and overfunding.
- Separate organizer/verifier permissions scoped to each campaign.
- Evidence commitments, revisions, rejection, resubmission, and stale reviews.
- Sequential milestones, approval requirements, and exact release amounts.
- Insufficient campaign funds, cross-campaign isolation, and duplicate releases.
- Full three-milestone completion and conservation of recorded funds.
- Ordinary direct-transfer rejection.
- Recipient-transfer failure with rollback and successful retry.
- A callback from the recipient that fails to reenter release.
- Reproducible evidence fingerprints.
- Refusal to deploy on a different chain ID, tested on another local simulation.

`npm run demo`: completed the full 1 + 2 + 3 local ETH workflow. Four forbidden actions were blocked. Final balances: 6 raised, 6 released, 0 available. See `reports/demo-result.json` for the local-run receipts and event data.

The persistent local node was also started on loopback. `deploy:local` deployed the compiled contract, `inspect:local` read its chain ID and empty initial state, and a second deployment invocation correctly reused the existing contract. The node was stopped after verification. No active deployment manifest is bundled because the user's local node must generate its own.

## Limits of these checks

Passing this suite is not an independent security audit, formal verification, fuzzing campaign, or proof of production safety. Evidence authenticity, verifier identity, collusion, cancellation, refunds, disputes, and liveness when a participant disappears are not solved here.

The package provides Windows-friendly npm commands, but execution was validated on Linux with Node.js 24.19.0, not on the user's Windows laptop. The frontend is not connected to the contract in this milestone.
