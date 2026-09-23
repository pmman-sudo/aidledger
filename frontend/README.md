# AidLedger

A working educational prototype for transparent aid funding. All campaigns, balances, roles, evidence, and releases are fictional. No wallet or blockchain is connected.

## Working features

- Dashboard with computed raised, released, pending, and approved totals.
- Campaign search and status filters; three explicit milestone budgets per campaign.
- Demo contributions with integer-cent arithmetic and overfunding protection.
- Evidence submission, approval or changes requested, resubmission, and sequential release.
- Release rules prevent unapproved, duplicate, out-of-order, and insufficient-balance releases.
- Activity history retains submitted evidence and review notes.
- Local browser persistence with schema validation and a confirmed reset.
- Accessible dialogs, keyboard controls, responsive layouts, and a custom favicon.

## Try the workflow

1. Open a campaign and choose Add demo funds.
2. Select the Organizer demo role to submit evidence for its next available milestone.
3. Select Verifier to review the evidence. Approve it or request changes with a note.
4. Select Organizer again and release the approved milestone if its balance is sufficient.
5. Inspect Proof history for the resulting record.

The sample Benin campaign has evidence waiting for review; the sample water campaign has an approved first milestone ready for release.

## Run locally

Use Node.js 22.13+ (Node.js 24 recommended) and the package manager declared in package.json: pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For production output:

```sh
pnpm build
```

The React application uses TypeScript, Tailwind, Radix-based Shadcn components, and the Vinext/Vite runtime. There are no app API secrets or database credentials to configure. Follow the dev server's printed local URL.

## Source map

- `app/page.tsx`: application screens, forms, local persistence, optional WebMCP registration.
- `app/globals.css`: theme and responsive layouts.
- `lib/ledger.ts`: pure transition rules, integer amount helpers, fictional seed records.
- `app/layout.tsx`: document metadata.

## Scope and limitations

Local storage is editable and device-specific. It is not a secure shared database or immutable ledger. Role switching simulates workflow permissions; it is not authentication or independent reviewer identity. Approval does not prove a real-world claim. Do not enter real personal or patient data. There are no uploads, real payments, wallet interactions, deployed contracts, or on-chain proofs in this version.

Browser state persists only on the same origin in the same browser. Concurrent tabs are not synchronized; use one tab when changing the demo. The prototype is bounded to 30 campaigns and 1,500 activity records. Reset restores the sample data.

## Validation

The initial build passed TypeScript checking and the production build. The ledger transition checks covered the end-to-end lifecycle, rejection and resubmission, role rules, overfunding, insufficient balance, duplicate releases, sequential milestones, decimal validation, and preserving the input state.

Optional WebMCP tools expose a read-only campaign summary and campaign navigation when the browser supports document.modelContext. This environment did not support that API, so those tools could not be exercised in-browser. They are not required for the visible application.
