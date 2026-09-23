// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import "../AidLedger.sol";

/// @dev Test fixture only. Demonstrates a rejecting recipient and a blocked
/// callback into the escrow. Never used by the demo deployment.
contract RecipientHarness {
    AidLedger public immutable ledger;
    uint256 public campaignId;
    uint8 public mode; // 0 accept, 1 reject, 2 try to reenter
    bool public attempted;
    bool public reentrySucceeded;
    bytes4 public callbackError;

    constructor(AidLedger ledger_) { ledger = ledger_; }

    function create(address verifier) external {
        string[3] memory titles = [string("Supplies"), "Delivery", "Handover"];
        uint256[3] memory amounts = [uint256(1 ether), 1 ether, 1 ether];
        campaignId = ledger.createCampaign("Recipient test campaign", keccak256("sample"),
            verifier, payable(address(this)), titles, amounts);
    }

    function setMode(uint8 value) external { mode = value; }
    function submit(uint8 milestoneId, bytes32 evidenceHash) external {
        ledger.submitEvidence(campaignId, milestoneId, evidenceHash);
    }
    function release(uint8 milestoneId) external { ledger.releaseFunds(campaignId, milestoneId); }

    receive() external payable {
        if (mode == 1) revert("TEST_RECIPIENT_REJECTS");
        if (mode == 2) {
            attempted = true;
            (bool ok, bytes memory result) = address(ledger).call(
                abi.encodeCall(ledger.releaseFunds, (campaignId, uint8(0)))
            );
            reentrySucceeded = ok;
            if (result.length >= 4) callbackError = bytes4(result);
        }
    }
}
