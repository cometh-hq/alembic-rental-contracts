// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./RentalProtocol.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

contract LentNFT is ERC721Upgradeable {
    address public rentalProtocol;
    ERC721Upgradeable public originalNFT;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _rentalProtocol, address _originalNFT) public initializer {
        __ERC721_init("Lent NFT", "lNFT");
        rentalProtocol = _rentalProtocol;
        originalNFT = ERC721Upgradeable(_originalNFT);
    }

    function mint(address to, uint256 tokenId) external {
        require(msg.sender == rentalProtocol, "Forbidden");
        _mint(to, tokenId);
    }

    function safeMint(address to, uint256 tokenId) external {
        require(msg.sender == rentalProtocol, "Forbidden");
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        require(msg.sender == rentalProtocol, "Forbidden");
        _burn(tokenId);
    }

    function _beforeTokenTransfer(
        address,
        address,
        uint256
    ) internal view override {
        require(RentalProtocol(rentalProtocol).paused() == false, "Rental paused");
    }

    function name() public view virtual override returns (string memory) {
        return string(abi.encodePacked("l", originalNFT.name()));
    }

    function symbol() public view virtual override returns (string memory) {
        return string(abi.encodePacked("l", originalNFT.symbol()));
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        return originalNFT.tokenURI(tokenId);
    }
}
