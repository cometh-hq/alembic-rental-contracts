// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract BorrowedNFT is ERC721, Ownable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct DistributionSlot {
        address user;
        uint64 rewards;
    }
    mapping (uint256 => DistributionSlot[]) private distributionByTokenId;

    constructor() ERC721("Borrowed NFT", "vNFT") {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function mint(address to, uint256 tokenId, address owner, uint64 distributedRewards) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "LentNFT: must have minter role");
        _mint(to, tokenId);
        DistributionSlot memory slot = DistributionSlot({
            user: owner,
            rewards: distributedRewards
        });
        distributionByTokenId[tokenId].push(slot);
    }

    function burn(uint256 tokenId) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "LentNFT: must have minter role");
        _burn(tokenId);
    }

    function distributionOf(uint256 tokenId) public view returns (DistributionSlot[] memory) {
        return distributionByTokenId[tokenId];
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
