# AidLedger cloud milestone

This deployment keeps the existing Hardhat demo available while adding a separate public-testnet path:

- **Vercel** serves the Next.js dashboard.
- **Northflank** runs the Node.js API from `cloud/Dockerfile`.
- **Northflank PostgreSQL** stores exact evidence bytes and the recovery journal.
- **Polygon Amoy (chain 80002)** stores campaign escrow, fingerprints, roles, and request IDs.
- **MetaMask** signs every transaction. The API never receives a wallet private key.

Use test POL only. `AidLedgerCloud` has not been independently audited for real funds.

## 1. Put the project in GitHub

Commit the project after running:

```powershell
npm.cmd test
cd frontend
node .\node_modules\next\dist\bin\next build --webpack
```

Do not commit `.env` files, private keys, or database passwords. Commit `artifacts/AidLedgerCloud.json` because the cloud container loads that ABI.

## 2. Deploy the Amoy contract

Create a dedicated MetaMask account for this testnet deployment and fund it with a small amount of Amoy test POL. Obtain an Amoy RPC URL. In a fresh PowerShell window, from the contracts folder:

```powershell
$env:AMOY_RPC_URL = "YOUR_AMOY_RPC_URL"
$env:DEPLOYER_PRIVATE_KEY = Read-Host "Paste the dedicated Amoy deployer private key"
npm.cmd run deploy:amoy
Remove-Item Env:DEPLOYER_PRIVATE_KEY
Get-Content .\deployments\amoy.json
```

Record `contractAddress` and `deploymentBlock`. The deployer key is used only by this command. It does not belong in Northflank or Vercel.

## 3. Create PostgreSQL in Northflank

Create one PostgreSQL add-on in your Northflank project. Copy its internal connection string for the API service. The service creates the `documents` and `wallet_requests` tables at startup.

## 4. Create the Northflank API service

Create a combined/build service from the GitHub repository with these settings:

| Setting | Value |
|---|---|
| Build type | Dockerfile |
| Build context | repository root |
| Dockerfile | `cloud/Dockerfile` |
| Port | `8080` |
| Health path | `/health` |

Add these runtime variables:

| Variable | Value |
|---|---|
| `AMOY_RPC_URL` | Your Polygon Amoy RPC HTTPS URL |
| `CONTRACT_ADDRESS` | `contractAddress` from `deployments/amoy.json` |
| `DEPLOYMENT_BLOCK` | `deploymentBlock` from that file |
| `DATABASE_URL` | Northflank PostgreSQL connection string |
| `FRONTEND_ORIGIN` | Exact Vercel URL, with no trailing slash |
| `PORT` | `8080` |

Expose a public HTTPS endpoint and verify `https://YOUR_API_HOST/health` returns `{"ok":true,"chainId":80002}`.

## 5. Deploy the dashboard to Vercel

Import the same GitHub repository into Vercel. Set the project root directory to `frontend`. Add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_AIDLEDGER_MODE` | `cloud` |
| `NEXT_PUBLIC_AIDLEDGER_API_URL` | The Northflank public HTTPS endpoint, without a trailing slash |

Deploy. If Vercel assigned a different production domain than the one placed in `FRONTEND_ORIGIN`, update that Northflank variable and redeploy the API.

## 6. Demonstrate the complete flow

Use three separate MetaMask accounts on Polygon Amoy:

1. Organizer creates a campaign and enters separate verifier and recipient addresses.
2. A donor contributes enough test POL for milestone 1.
3. Organizer submits evidence. PostgreSQL saves the exact JSON and the contract saves its hash.
4. Verifier reviews the displayed revision and fingerprint.
5. Organizer releases the fixed milestone budget to the fixed recipient.
6. Open **Proof history** and show the request ID and transaction hash.

If the wallet broadcasts but the browser loses the returned hash, **Check status** searches contract events for the saved request ID. A successful request ID cannot execute twice.

## Environment boundary

`DEPLOYER_PRIVATE_KEY` exists only in the temporary deployment shell. Northflank receives RPC, contract, database, and allowed-origin settings. Vercel receives only public mode and API URL settings. MetaMask holds user keys and asks the user to approve every transaction.
