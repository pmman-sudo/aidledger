# AidLedger frontend — Windows setup

This is the existing AidLedger dashboard source, exported from commit `2be51d2b133e050951f4aa1d5d4a68367507a6b6`. It is the same application code as the hosted demo. The only added file is this setup guide; a generated TypeScript build cache was omitted.

## Add it to your existing AidLedger folder

The ZIP contains a `frontend` folder. Extract that folder into:

`C:\Users\USER\Projects\AidLedger-20260921-211543\AidLedger-Local-Contracts`

The resulting path should be:

`C:\Users\USER\Projects\AidLedger-20260921-211543\AidLedger-Local-Contracts\frontend\package.json`

Keep the frontend's package.json inside `frontend`. Do not replace your contracts package.json.

From the VS Code terminal opened at AidLedger-Local-Contracts:

```powershell
cd frontend
npm.cmd exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
```

Wait for a successful installation before running:

```powershell
npm.cmd run dev
```

Open the address printed by the server (normally http://localhost:5173). Keep the terminal running; Ctrl+C stops it. This is the frontend development server, not a blockchain node.

Node.js 24 is recommended. The frontend uses pnpm and includes pnpm-lock.yaml, not package-lock.json. Do not run npm ci in this frontend folder. No wallet, API key, or paid service is needed for this version.

## What this delivers

- Existing dashboard, campaigns, milestone forms, evidence/review screens, demo role switching, activity history, and styling.
- Original TypeScript, React, UI components, public assets, Vinext/Vite configuration, and dependency lockfile.
- Browser-local demo state, stored separately for each browser origin. Existing hosted-site demo data will not automatically appear on localhost.

## What remains unfinished

The dashboard still uses simulated browser data. Copying it into the contracts project does not connect it to a blockchain. Wallet/RPC integration, actual contract calls, and UI transaction recovery remain to be implemented. Print Job Lab is not required.

## Verification limits

The original dashboard previously passed its build, typecheck, and browser workflow checks. This export preserves its application source. Windows execution and a fresh dependency installation have not been verified in the export environment. Report any install/start error before continuing; do not replace the lockfile to work around it.

Export smoke check: the portable development server started on Linux using existing dependencies and returned HTTP 200 with the AidLedger page. This does not verify a fresh Windows dependency install or interactive browser behavior.
