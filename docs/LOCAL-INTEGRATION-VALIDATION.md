# Validation — September 22, 2026

Completed in the development environment using Node 24.19.0, ethers 6.17.0, Hardhat 3.17.0, Solidity 0.8.37 and native Next.js 16.3.4 with webpack. The installer is cross-platform Node.js and targets the existing Windows package; Windows execution itself has not been repeated here.

- Original contract suite: 28 passed.
- New integration suite: 10 passed.
- Combined npm test: 38 passed, 0 failed.
- Frontend TypeScript: no errors with `tsc --noEmit --incremental false`.
- Native Next.js dashboard: HTTP 200.
- Original browser demo route: HTTP 200.
- Removed the information banner from both routes.
- Next.js API rewrite to loopback service: campaign creation confirmed on the running Hardhat node; receipt recovered using the original request identifier.
- Installer checked against an isolated project folder with spaces: changed-file backups, dependency/lockfile preservation, deployment preservation, repeat installation and content hashes verified.

The 10 integration tests cover:

1. Campaign creation, funding, evidence, reviews and all three releases; exact 6 ETH conservation.
2. Repeated request identifiers and app restart recovery without a duplicate campaign.
3. Failure before broadcast and manual resend of the exact saved transaction.
4. RPC response lost after mining; original hash is reconciled.
5. Wrong-role rejection, stale review rejection, revised evidence and funding-gated retry.
6. Node instance change archives requests and blocks replay.
7. Foreign HTTP writes blocked; deliberately lost HTTP response recovered.
8. Changed evidence bytes in the journal detected on startup.
9. Pending transaction recovered after service restart and confirmed after mining.
10. Transaction passing preflight but reverting at mining is reported as reverted.

Browser rendering and click-through automation were not run because a browser binary was unavailable. Type checking, route rendering, contract behavior and actual HTTP writes were verified. The local service is intended for a single development user and is not a production deployment or security audit.
