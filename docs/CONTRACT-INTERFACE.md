# AidLedger contract interface

This describes the local contract delivered in this milestone. It is a reference for the later frontend connection, not a claim that the existing website already uses it.

## Amounts and identifiers

- Contract amounts are uint256 integer **wei**. Use `parseEther("1.25")` and `formatEther(value)` at the edge of an ethers client. Never use JavaScript floating point or `Number` for contract arithmetic.
- Keep contract amounts as bigint in JavaScript and decimal strings in JSON. The demo report's serializer handles bigint values.
- The existing browser demo uses integer cents of fictional credits. Do not copy those values into this contract or claim a conversion rate; a connected local mode needs a separate currency label and data adapter.
- Campaign IDs start at 0 and increase. Milestone IDs are 0, 1, and 2. The UI can display them as milestones 1, 2, and 3.

## Status mapping

| Solidity value | Contract name | Existing demo state |
| --- | --- | --- |
| 0 | Planned | `planned` |
| 1 | Pending | `pending` |
| 2 | Approved | `approved` |
| 3 | Rejected | `rejected` |
| 4 | Released | `released` |

Transitions are Planned → Pending → Approved → Released, or Pending → Rejected → Pending. Evidence cannot be replaced while pending or approved. Rejection preserves the old commitment in events; resubmission increments the revision and clears the latest review hash.

## Functions

| Function | Caller / purpose |
| --- | --- |
| `createCampaign(title, metadataHash, verifier, recipient, string[3], uint256[3])` | Any local account becomes that campaign's organizer. Creates its fixed roles and milestone budgets. |
| `contribute(campaignId)` with transaction `value` | Adds positive native local test currency, at most the remaining goal. |
| `submitEvidence(campaignId, milestoneId, evidenceHash)` | Campaign organizer only; current planned/rejected milestone only. |
| `reviewMilestone(campaignId, milestoneId, expectedRevision, expectedEvidenceHash, reviewHash, approve)` | Designated verifier only; current pending milestone. Both hash and revision must match. |
| `releaseFunds(campaignId, milestoneId)` | Organizer only; approved current milestone, adequate campaign balance. Sends exactly that milestone amount to the fixed recipient. |
| `getCampaign(campaignId)` | Returns roles, title, metadata fingerprint, goal, raised, released, available, next milestone, and completion state. |
| `getMilestone(campaignId, milestoneId)` | Returns title, budget, status, evidence fingerprint, review fingerprint, and revision. |
| `contributions(campaignId, account)` | Cumulative contributions by a donor. This is not a refundable-balance function. |
| `campaignCount()` | Number of campaigns. |
| `totalEscrowed()` | Recorded contributions minus successful releases across all campaigns. |

The generated ABI is in `artifacts/AidLedger.json`. After a local-node deployment, `deployments/localhost.json` includes the same ABI and that node's contract address.

## Evidence commitments

Use `keccak256` on the **exact file bytes**, not a later reserialization of the JSON. `scripts/runtime.mjs` provides `hashFile` and the demo uses it on the checked-in sample files.

Changing whitespace, a line ending, a value, or a byte-order mark changes the fingerprint. Keep the referenced bytes with the corresponding record. Hashes are not encryption; do not commit sensitive documents, even by hash, in this educational example.

Before review, fetch the latest milestone and pass its `revision` and `evidenceHash`. If the transaction reports `StaleEvidence`, refresh the record and review the new evidence rather than blindly retrying approval.

The metadata hash identifies a campaign document. The contract directly enforces its stored title, fixed roles, and milestone amounts; it does not parse or validate the off-chain metadata document.

## Events for a later activity view

| Event | Meaning |
| --- | --- |
| `CampaignCreated` | Fixed roles, title, metadata hash, goal. |
| `ContributionAdded` | Campaign, donor, value, total raised. |
| `EvidenceSubmitted` | Campaign, milestone, organizer, revision, evidence hash. |
| `MilestoneReviewed` | Campaign, milestone, verifier, revision, evidence hash, review hash, decision. |
| `FundsReleased` | Campaign, milestone, fixed recipient, amount, revision, evidence hash, review hash. |

Use the confirmed transaction hash, block number, and log index to identify activity. Wait for a successful receipt, then refresh contract state. Approval and release are separate transactions; do not mark a milestone released when only approval has succeeded.

## Key errors to surface clearly

| Error | Suggested user-facing explanation |
| --- | --- |
| `OrganizerOnly` | Use this campaign's organizer test account. |
| `VerifierOnly` | Use this campaign's designated verifier test account. |
| `WrongMilestoneOrder` | Release the previous milestone first. |
| `InvalidStatus` | The milestone is not in a state that allows this action. |
| `StaleEvidence` | Evidence has changed; refresh and review the current submission. |
| `InsufficientCampaignBalance` | The campaign needs more local demo funding. |
| `FundingGoalExceeded` | The contribution exceeds the remaining goal. |
| `TransferFailed` | The recipient rejected the transfer; no release was recorded. |
| `CampaignComplete` | Every milestone has already been released. |

## Next integration boundary

The next UI milestone should read actual local contract state, sign using the appropriate local test account, display pending/success/failure, and load events into history. It must label local ETH distinctly from the older browser demo credits. Neither the hosted private site nor this package currently supplies a bridge between a remote webpage and a user's local node.
