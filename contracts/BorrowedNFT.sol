// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./RentalProtocol.sol";
import "./IRewardsSplitter.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract BorrowedNFT is ERC721Upgradeable, IRewardsSplitter {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint64 public constant MAX_BASIS_POINTS = 100_00;

    address public rentalProtocol;
    ERC721Upgradeable public originalNFT;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _rentalProtocol, address _originalNFT) public initializer {
        __ERC721_init("Borrowed NFT", "bNFT");
        rentalProtocol = _rentalProtocol;
        originalNFT = ERC721Upgradeable(_originalNFT);
    }

    function mint(address to, uint256 tokenId) external {
        require(_msgSender() == rentalProtocol, "Forbidden");
        _mint(to, tokenId);
    }

    function safeMint(address to, uint256 tokenId) external {
        require(_msgSender() == rentalProtocol, "Forbidden");
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        require(_msgSender() == rentalProtocol, "Forbidden");
        _burn(tokenId);
    }

    function onERC20Received(
        uint256 tokenId,
        address _token,
        uint256 amount
    ) external override returns (bytes4) {
        IERC20Upgradeable token = IERC20Upgradeable(_token);
        require(token.balanceOf(address(this)) >= amount, "Didn't receive enough ERC20");
        IRentalProtocol.Fee[] memory fees = RentalProtocol(rentalProtocol).getFeesTable(address(originalNFT), tokenId);
        uint256 remaining = amount;
        for (uint256 i = 0; i < fees.length; i++) {
            IRentalProtocol.Fee memory fee = fees[i];
            uint256 reward = (remaining * fee.basisPoints) / MAX_BASIS_POINTS;
            remaining -= reward;
            token.safeTransfer(fee.to, reward);
            emit IRewardsSplitter.RewardsDistributed(tokenId, fee.to, address(token), reward);
        }
        address borrower = ownerOf(tokenId);
        token.safeTransfer(borrower, remaining);
        emit IRewardsSplitter.RewardsDistributed(tokenId, borrower, address(token), remaining);
        return this.onERC20Received.selector;
    }

    function _beforeTokenTransfer(
        address,
        address,
        uint256
    ) internal view override {
        require(RentalProtocol(rentalProtocol).paused() == false, "Rental paused");
    }

    function name() public view virtual override returns (string memory) {
        return string(abi.encodePacked("b", originalNFT.name()));
    }

    function symbol() public view virtual override returns (string memory) {
        return string(abi.encodePacked("b", originalNFT.symbol()));
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        return originalNFT.tokenURI(tokenId);
    }

    /**
     * @dev overriden in order to allow the rental protocol to make transfer without
     *      asking for explicit approval upfront
     */
    function isApprovedForAll(address owner, address operator) public view virtual override returns (bool) {
        return operator == rentalProtocol ? true : super.isApprovedForAll(owner, operator);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721Upgradeable) returns (bool) {
        return interfaceId == type(IRewardsSplitter).interfaceId || super.supportsInterface(interfaceId);
    }
}
