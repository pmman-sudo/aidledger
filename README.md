# AidLedger

### Transparent aid funding, one verified milestone at a time.

AidLedger is a blockchain-backed crowdfunding prototype that connects campaign funding, milestone evidence, verifier decisions, and staged payments in one dashboard.

Funds are held in a smart contract and released to the campaign’s designated recipient after the current milestone receives verifier approval.

Built for **3rd-Web-Hack**.

## Links

- **Live application:** https://aidledge-lemon.vercel.app/
- **Source code:** https://github.com/pmman-sudo/aidledger
- **Deployed contract:** https://amoy.polygonscan.com/address/0xe1B1BC42a0e8f0C3c9Fda13086d8D1Af660d163f

> This is a Polygon Amoy testnet prototype. Campaign examples are fictional, and test POL has no real monetary value. The contracts have not undergone an independent security audit.

## The Problem

Donors can struggle to understand what happens after contributing to an aid campaign:

- What work was promised?
- What evidence supports a payment?
- Who reviewed that evidence?
- How much funding remains?
- Did a transaction succeed when the browser or network failed?

A transfer record alone does not explain why funds were released or whether a project milestone was reviewed.

## The Solution

AidLedger organizes a campaign around fixed milestone budgets and distinct responsibilities.

1. An organizer creates a campaign with a recipient and verifier.
2. Donors contribute test POL to the campaign’s smart-contract escrow.
3. The organizer submits evidence for the current milestone.
4. The designated verifier reviews that evidence.
5. Following approval, the organizer releases the milestone budget.
6. The dashboard displays the remaining funds, evidence, review, and transaction history.

The verifier address must differ from both the organizer and recipient addresses. This separates permissions at the wallet level; it does not establish that the wallets belong to independent people.

## Features

### Milestone-based escrow

- Three milestones with fixed budgets.
- Campaign-specific contribution tracking.
- Rejection of zero contributions and contributions above the funding goal.
- Sequential milestone progression.
- Release of approved milestone budgets to the designated recipient.

### Evidence and review records

- Exact evidence and review content stored in PostgreSQL.
- Cryptographic fingerprints recorded on Polygon Amoy.
- Evidence revision tracking.
- Verifier decisions associated with the submitted revision.
- Dashboard comparison of saved evidence against its on-chain fingerprint.

A matching fingerprint demonstrates that content matches the committed record. It does **not** prove that the reported real-world activity happened.

### Wallet transaction recovery

- Requests are recorded before the wallet transaction is submitted.
- The browser retains the active request for recovery after a refresh.
- Known transaction hashes can be checked for confirmation.
- Contract events can help recover successful transactions using saved request IDs.
- Successfully processed request IDs cannot execute twice.
- The interface distinguishes transaction outcomes and supports checking unresolved requests.

Recovery helps users investigate interrupted operations without blindly submitting another transaction.

### Public transaction history

- Campaign funding and release totals.
- Milestone evidence and verifier notes.
- Transaction hashes and explorer links.
- Visible request status.

## Demonstrated Testnet Workflow

The live demo campaign, **Clean Water for Ekosodin — Demo**, has demonstrated:

- Campaign creation.
- Full funding of its 0.004 test POL goal.
- Evidence submission for milestone 1.
- Approval from the designated verifier wallet.
- Release of milestone 1’s 0.001 test POL budget.
- Updated totals showing 0.003 test POL remaining in escrow.

These are testnet transactions for a fictional campaign, not evidence of a real aid project.

## Architecture

| Component | Responsibility | Technology |
|---|---|---|
| Frontend | Campaign dashboard, wallet interaction, recovery interface | Next.js, React, TypeScript, Tailwind CSS |
| Wallet | User approval and transaction signing | MetaMask |
| API | Transaction preparation, state queries, request reconciliation | Node.js, ethers.js |
| Database | Evidence, review content, persistent request journal | PostgreSQL |
| Smart contract | Escrow, permissions, milestone state, fingerprints, request IDs | Solidity |
| Blockchain | Public transaction execution and records | Polygon Amoy |
| Frontend hosting | Dashboard deployment | Vercel |
| Backend hosting | Containerized API and database | Northflank |

Users sign transactions in MetaMask. The API does not require or receive their wallet private keys.

## Deployment Details

| Setting | Value |
|---|---|
| Network | Polygon Amoy |
| Chain ID | 80002 |
| Gas token | Test POL |
| Contract | `0xe1B1BC42a0e8f0C3c9Fda13086d8D1Af660d163f` |
| Deployment block | `48435173` |
| Contract deployment transaction | `0xd3113e8edeb30e3629548b20d5fd31dc6571e966999f2dfd97410116462a8943` |

## Repository Structure

| Path | Purpose |
|---|---|
| `contracts/` | Solidity contracts |
| `test/` | Contract, integration, and cloud-service tests |
| `scripts/` | Compilation, deployment, and local development utilities |
| `artifacts/` | Compiled contract ABI and bytecode |
| `deployments/` | Deployment records |
| `cloud/` | Node.js API, PostgreSQL integration, Dockerfile |
| `frontend/` | Dashboard application |
| `docs/CLOUD-DEPLOYMENT.md` | Additional deployment documentation |

## Getting Started

### Prerequisites

- Node.js 24.x and npm.
- Git.
- PostgreSQL for the cloud API.
- MetaMask for submitting testnet transactions.
- Access to a Polygon Amoy RPC endpoint.
- Amoy test POL for each wallet that submits transactions.

### 1. Clone and install

```bash
git clone https://github.com/pmman-sudo/aidledger.git
cd aidledger
npm ci
```

### 2. Compile and test

```bash
npm run compile
npm test
```

The test suite covers areas including campaign validation, role restrictions, contributions, milestone lifecycle, evidence and review fingerprints, and request-ID protection.

### 3. Install API dependencies

```bash
cd cloud
npm ci
```

Create an untracked file named `.env` inside `cloud/`:

```dotenv
PORT=8080
AMOY_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
CONTRACT_ADDRESS=0xe1B1BC42a0e8f0C3c9Fda13086d8D1Af660d163f
DEPLOYMENT_BLOCK=48435173
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DATABASE
FRONTEND_ORIGIN=http://localhost:3000
```

Replace the database placeholders with your own credentials. Use your database provider’s required TLS configuration for hosted PostgreSQL.

The API initializes its required tables at startup; its database user must have permission to create them.

Start the API with explicit environment-file loading:

```bash
node --env-file=.env server.mjs
```

Check:

```text
http://localhost:8080/health
```

Expected response:

```json
{"ok":true,"chainId":80002}
```

This health response is a basic service check, not a complete verification of every application dependency.

### 4. Install and run the frontend

Open another terminal from the repository root:

```bash
cd frontend
npx --yes pnpm@11.25.0 install --frozen-lockfile
```

Create an untracked `frontend/.env.local` file:

```dotenv
NEXT_PUBLIC_AIDLEDGER_MODE=cloud
NEXT_PUBLIC_AIDLEDGER_API_URL=http://localhost:8080
```

Run the Next.js dashboard:

```bash
node node_modules/next/dist/bin/next dev --webpack
```

Open:

```text
http://localhost:3000
```

This configuration runs the frontend and API locally while using the deployed contract on Polygon Amoy. Transactions still require Amoy test POL.

### 5. Build the frontend

From `frontend/`:

```bash
node node_modules/next/dist/bin/next build --webpack
```

## Using the Demo

### Accounts

Use an organizer wallet and a separate verifier wallet. The recipient may be the organizer or another address, but cannot be the verifier.

Each wallet submitting a transaction needs its own test POL for gas.

Before an action, check the wallet address displayed in AidLedger. Selecting an account in MetaMask does not always change the account connected to the application.

### Example campaign

**Title:** Clean Water for Ekosodin — Demo  
**Location:** Ekosodin, Edo State, Nigeria

| Milestone | Budget |
|---|---:|
| Site survey and materials procurement | 0.001 test POL |
| Borehole drilling and pump installation | 0.002 test POL |
| Storage tank setup and community handover | 0.001 test POL |
| **Total** | **0.004 test POL** |

Clearly label all demonstration evidence as fictional.

### Walkthrough

1. Connect the organizer wallet on Polygon Amoy.
2. Create a campaign with valid verifier and recipient addresses.
3. Contribute up to the campaign’s funding goal.
4. Submit evidence for the current milestone.
5. Wait for transaction confirmation.
6. Connect the designated verifier wallet.
7. Review the evidence and submit a decision.
8. After approval, reconnect the organizer wallet.
9. Release the milestone funds.
10. Inspect the campaign totals and proof history.

Gas fees are separate from campaign contributions.

## Handling Interrupted Transactions

If a transaction appears stuck or its result is unclear:

1. Keep the saved request ID and any transaction hash.
2. Use **Check status** to reconcile the request.
3. Inspect the transaction in the Amoy explorer when a hash is available.
4. Use the recovery interface for the existing request.
5. Avoid creating another request until the original outcome is understood.

Do not delete browser recovery data simply to remove an unresolved banner.

## Hosting Configuration

### Vercel

| Setting | Value |
|---|---|
| Repository | `pmman-sudo/aidledger` |
| Production branch | `main` |
| Root directory | `frontend` |
| Framework | Next.js |
| Node.js | 24.x |
| Install command | `npx --yes pnpm@11.25.0 install --frozen-lockfile` |
| Build command | `node node_modules/next/dist/bin/next build --webpack` |

Frontend environment variables:

```dotenv
NEXT_PUBLIC_AIDLEDGER_MODE=cloud
NEXT_PUBLIC_AIDLEDGER_API_URL=https://YOUR_PUBLIC_API_HOST
```

### Northflank

| Setting | Value |
|---|---|
| Build context | Repository root |
| Dockerfile | `cloud/Dockerfile` |
| HTTP port | `8080` |
| Readiness path | `/health` |

Configure these runtime variables:

```dotenv
PORT=8080
AMOY_RPC_URL=YOUR_AMOY_RPC_URL
CONTRACT_ADDRESS=YOUR_DEPLOYED_CONTRACT_ADDRESS
DEPLOYMENT_BLOCK=YOUR_CONTRACT_DEPLOYMENT_BLOCK
DATABASE_URL=YOUR_PRIVATE_POSTGRESQL_CONNECTION_STRING
FRONTEND_ORIGIN=https://YOUR_FRONTEND_DOMAIN
```

`FRONTEND_ORIGIN` must match the frontend’s origin, including `https://`, without a trailing slash.

The API container requires `artifacts/AidLedgerCloud.json`. Ensure that artifact is available in the repository used for the build.

## Security and Trust Boundaries

- Never commit private keys, seed phrases, database credentials, or environment files.
- Never put secrets in variables prefixed with `NEXT_PUBLIC_`; these are exposed to the browser.
- Keep any deployment private key confined to the local deployment process.
- Organizer and verifier permissions are enforced by the smart contract.
- Separate wallet addresses do not guarantee independent human reviewers.
- Evidence fingerprints protect record integrity, not factual accuracy.
- Off-chain evidence availability depends on the API and database.
- This prototype has not been independently audited and is not intended for real funds.

## Limitations

- The demonstrated campaign and evidence are fictional.
- Wallet setup, test-token funding, and gas fees add onboarding friction.
- Transaction confirmation depends on RPC and network availability.
- The project does not independently authenticate field work or verifier identity.
- Production dispute handling, refunds, identity checks, and operational safeguards require further development and review.

## Future Development

- Richer evidence attachments and supporting documents.
- Verifier identity and accountability mechanisms.
- Multiple-reviewer approval options.
- Dispute and refund workflows.
- Improved wallet onboarding and transaction diagnostics.
- Database backup and evidence-availability improvements.
- Independent smart-contract security review.
- Pilot evaluation with aid organizations.

## Author

**Paul Iyen**

GitHub: https://github.com/pmman-sudo

---

**AidLedger — Track the funding. See the proof. Follow the progress.**