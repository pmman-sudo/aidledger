// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title AidLedger Cloud — milestone escrow with recoverable wallet requests
/// @notice Designed for a public test network. Native currency has test-only value.
/// @dev Every mutation carries a unique request ID. Successful IDs cannot execute twice.
contract AidLedgerCloud {
    uint8 public constant MILESTONE_COUNT = 3;

    enum Status { Planned, Pending, Approved, Rejected, Released }

    struct Milestone {
        string title;
        uint256 amount;
        Status status;
        bytes32 evidenceHash;
        bytes32 reviewHash;
        uint64 revision;
    }

    struct Campaign {
        address organizer;
        address verifier;
        address payable recipient;
        string title;
        bytes32 metadataHash;
        uint256 goal;
        uint256 raised;
        uint256 released;
        uint8 nextMilestone;
        Milestone[3] milestones;
    }

    struct CampaignSummary {
        address organizer;
        address verifier;
        address recipient;
        string title;
        bytes32 metadataHash;
        uint256 goal;
        uint256 raised;
        uint256 released;
        uint256 available;
        uint8 nextMilestone;
        bool complete;
    }

    uint256 public campaignCount;
    uint256 public totalEscrowed;
    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(bytes32 => bool) public processedRequests;
    uint256 private entered = 1;

    error InvalidCampaign();
    error InvalidMilestone();
    error InvalidAddress();
    error ConflictingRoles();
    error InvalidTitle();
    error InvalidBudget();
    error EmptyHash();
    error InvalidRequestId();
    error DuplicateRequest();
    error OrganizerOnly();
    error VerifierOnly();
    error PositiveContributionRequired();
    error FundingGoalExceeded();
    error CampaignComplete();
    error WrongMilestoneOrder();
    error InvalidStatus();
    error StaleEvidence();
    error InsufficientCampaignBalance();
    error TransferFailed();
    error ReentrantCall();
    error DirectTransferNotSupported();

    event CampaignCreated(bytes32 indexed requestId, uint256 indexed campaignId,
        address indexed organizer, address verifier, address recipient, string title,
        bytes32 metadataHash, uint256 goal);
    event ContributionAdded(bytes32 indexed requestId, uint256 indexed campaignId,
        address indexed donor, uint256 amount, uint256 totalRaised);
    event EvidenceSubmitted(bytes32 indexed requestId, uint256 indexed campaignId,
        uint8 indexed milestoneId, address organizer, uint64 revision, bytes32 evidenceHash);
    event MilestoneReviewed(bytes32 indexed requestId, uint256 indexed campaignId,
        uint8 indexed milestoneId, address verifier, uint64 revision, bytes32 evidenceHash,
        bytes32 reviewHash, bool approved);
    event FundsReleased(bytes32 indexed requestId, uint256 indexed campaignId,
        uint8 indexed milestoneId, address recipient, uint256 amount, uint64 revision,
        bytes32 evidenceHash, bytes32 reviewHash);

    modifier nonReentrant() {
        if (entered != 1) revert ReentrantCall();
        entered = 2;
        _;
        entered = 1;
    }

    function createCampaign(
        bytes32 requestId,
        string calldata title,
        bytes32 metadataHash,
        address verifier,
        address payable recipient,
        string[3] calldata milestoneTitles,
        uint256[3] calldata milestoneAmounts
    ) external nonReentrant returns (uint256 campaignId) {
        _consume(requestId);
        if (verifier == address(0) || recipient == address(0) ||
            verifier == address(this) || recipient == address(this)) revert InvalidAddress();
        if (verifier == msg.sender || verifier == recipient) revert ConflictingRoles();
        _validateTitle(title);
        if (metadataHash == bytes32(0)) revert EmptyHash();

        campaignId = campaignCount++;
        Campaign storage campaign = campaigns[campaignId];
        campaign.organizer = msg.sender;
        campaign.verifier = verifier;
        campaign.recipient = recipient;
        campaign.title = title;
        campaign.metadataHash = metadataHash;
        for (uint8 i = 0; i < MILESTONE_COUNT; i++) {
            _validateTitle(milestoneTitles[i]);
            if (milestoneAmounts[i] == 0) revert InvalidBudget();
            campaign.goal += milestoneAmounts[i];
            campaign.milestones[i].title = milestoneTitles[i];
            campaign.milestones[i].amount = milestoneAmounts[i];
        }
        emit CampaignCreated(requestId, campaignId, msg.sender, verifier, recipient,
            title, metadataHash, campaign.goal);
    }

    function contribute(bytes32 requestId, uint256 campaignId) external payable nonReentrant {
        _consume(requestId);
        Campaign storage campaign = _campaign(campaignId);
        if (campaign.nextMilestone == MILESTONE_COUNT) revert CampaignComplete();
        if (msg.value == 0) revert PositiveContributionRequired();
        if (msg.value > campaign.goal - campaign.raised) revert FundingGoalExceeded();
        campaign.raised += msg.value;
        contributions[campaignId][msg.sender] += msg.value;
        totalEscrowed += msg.value;
        emit ContributionAdded(requestId, campaignId, msg.sender, msg.value, campaign.raised);
    }

    function submitEvidence(bytes32 requestId, uint256 campaignId, uint8 milestoneId,
        bytes32 evidenceHash) external nonReentrant {
        _consume(requestId);
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.organizer) revert OrganizerOnly();
        Milestone storage milestone = _currentMilestone(campaign, milestoneId);
        if (milestone.status != Status.Planned && milestone.status != Status.Rejected)
            revert InvalidStatus();
        if (evidenceHash == bytes32(0)) revert EmptyHash();
        milestone.evidenceHash = evidenceHash;
        milestone.reviewHash = bytes32(0);
        milestone.revision++;
        milestone.status = Status.Pending;
        emit EvidenceSubmitted(requestId, campaignId, milestoneId, msg.sender,
            milestone.revision, evidenceHash);
    }

    function reviewMilestone(bytes32 requestId, uint256 campaignId, uint8 milestoneId,
        uint64 expectedRevision, bytes32 expectedEvidenceHash, bytes32 reviewHash,
        bool approve) external nonReentrant {
        _consume(requestId);
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.verifier) revert VerifierOnly();
        Milestone storage milestone = _currentMilestone(campaign, milestoneId);
        if (milestone.status != Status.Pending) revert InvalidStatus();
        if (milestone.revision != expectedRevision ||
            milestone.evidenceHash != expectedEvidenceHash) revert StaleEvidence();
        if (reviewHash == bytes32(0)) revert EmptyHash();
        milestone.reviewHash = reviewHash;
        milestone.status = approve ? Status.Approved : Status.Rejected;
        emit MilestoneReviewed(requestId, campaignId, milestoneId, msg.sender,
            milestone.revision, milestone.evidenceHash, reviewHash, approve);
    }

    function releaseFunds(bytes32 requestId, uint256 campaignId, uint8 milestoneId)
        external nonReentrant {
        _consume(requestId);
        Campaign storage campaign = _campaign(campaignId);
        if (msg.sender != campaign.organizer) revert OrganizerOnly();
        Milestone storage milestone = _currentMilestone(campaign, milestoneId);
        if (milestone.status != Status.Approved) revert InvalidStatus();
        uint256 amount = milestone.amount;
        if (campaign.raised - campaign.released < amount) revert InsufficientCampaignBalance();
        milestone.status = Status.Released;
        campaign.released += amount;
        campaign.nextMilestone++;
        totalEscrowed -= amount;
        (bool sent,) = campaign.recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit FundsReleased(requestId, campaignId, milestoneId, campaign.recipient, amount,
            milestone.revision, milestone.evidenceHash, milestone.reviewHash);
    }

    function getCampaign(uint256 campaignId) external view returns (CampaignSummary memory) {
        Campaign storage c = _campaign(campaignId);
        return CampaignSummary(c.organizer, c.verifier, c.recipient, c.title,
            c.metadataHash, c.goal, c.raised, c.released, c.raised - c.released,
            c.nextMilestone, c.nextMilestone == MILESTONE_COUNT);
    }

    function getMilestone(uint256 campaignId, uint8 milestoneId)
        external view returns (Milestone memory) {
        Campaign storage campaign = _campaign(campaignId);
        if (milestoneId >= MILESTONE_COUNT) revert InvalidMilestone();
        return campaign.milestones[milestoneId];
    }

    function _consume(bytes32 requestId) private {
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (processedRequests[requestId]) revert DuplicateRequest();
        processedRequests[requestId] = true;
    }

    function _campaign(uint256 campaignId) private view returns (Campaign storage) {
        if (campaignId >= campaignCount) revert InvalidCampaign();
        return campaigns[campaignId];
    }

    function _currentMilestone(Campaign storage campaign, uint8 milestoneId)
        private view returns (Milestone storage) {
        if (milestoneId >= MILESTONE_COUNT) revert InvalidMilestone();
        if (campaign.nextMilestone == MILESTONE_COUNT) revert CampaignComplete();
        if (milestoneId != campaign.nextMilestone) revert WrongMilestoneOrder();
        return campaign.milestones[milestoneId];
    }

    function _validateTitle(string calldata title) private pure {
        if (bytes(title).length < 3 || bytes(title).length > 100) revert InvalidTitle();
    }

    receive() external payable { revert DirectTransferNotSupported(); }
    fallback() external payable { revert DirectTransferNotSupported(); }
}
