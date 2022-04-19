// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract BorrowedNFT is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint64 public constant MAX_DISTRIBUTED_REWARDS = 10000;

    struct DistributionSlot {
        address user;
        uint64 rewards;
    }

    struct DurationSlot {
        /// when the rental starts
        uint256 start;
        /// when the rental ends
        uint256 end;
    }

    /// Mapping (tokenId => DistributionSlot[])
    mapping(uint256 => DistributionSlot[]) private distributionByTokenId;
    /// Mapping (tokenId => DurationSlot[])
    mapping(uint256 => DurationSlot[]) private durationsByTokenId;

    constructor() ERC721("Borrowed NFT", "vNFT") {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function mint(
        address to,
        uint256 tokenId,
        address owner,
        uint256 start,
        uint256 end,
        uint64 distributedRewards
    ) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "BorrowedNFT: must have minter role");
        DistributionSlot memory distributionSlot = DistributionSlot({
            user: owner,
            rewards: MAX_DISTRIBUTED_REWARDS - distributedRewards
        });
        distributionByTokenId[tokenId].push(distributionSlot);
        DurationSlot memory durationSlot = DurationSlot({start: start, end: end});
        durationsByTokenId[tokenId].push(durationSlot);
        _mint(to, tokenId);
    }

    function lease(
        address to,
        uint256 tokenId,
        uint256 start,
        uint256 end,
        uint64 distributedRewards
    ) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "BorrowedNFT: must have minter role");
        DurationSlot[] memory durations = durationsByTokenId[tokenId];
        // durations table lenght should always be > 0 -- no need to check again
        DurationSlot memory lastDurationSlot = durations[durations.length - 1];
        // ensure start >= last start
        require(start >= lastDurationSlot.start, "Lease start time invalid");
        // ensure end <= last end
        require(end <= lastDurationSlot.end, "Lease end time invalid");
        // ensure no more than 10000 - previous allocated rewards
        DistributionSlot[] memory slots = distributionByTokenId[tokenId];
        uint64 allocatedRewards = 0;
        for (uint256 i = 0; i < slots.length; i++) {
            allocatedRewards += slots[i].rewards;
        }
        require(distributedRewards <= MAX_DISTRIBUTED_REWARDS - allocatedRewards, "No more than 100% of rewards");
        // add new distribution slot
        address owner = ownerOf(tokenId);
        DistributionSlot memory distributionSlot = DistributionSlot({
            user: owner,
            rewards: MAX_DISTRIBUTED_REWARDS - allocatedRewards - distributedRewards
        });
        distributionByTokenId[tokenId].push(distributionSlot);
        // add new duration slot
        DurationSlot memory durationSlot = DurationSlot({start: start, end: end});
        durationsByTokenId[tokenId].push(durationSlot);
        _transfer(owner, to, tokenId);
    }

    function burn(uint256 tokenId) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "BorrowedNFT: must have minter role");
        _burn(tokenId);
    }

    function distributionOf(uint256 tokenId) public view returns (DistributionSlot[] memory) {
        return distributionByTokenId[tokenId];
    }

    function durationsOf(uint256 tokenId) public view returns (DurationSlot[] memory) {
        return durationsByTokenId[tokenId];
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
