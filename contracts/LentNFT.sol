// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./RentalProtocol.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

contract LentNFT is ERC721Upgradeable {
    address public rentalProtocol;
    ERC721Upgradeable public originalNFT;
    string public uriPrefix;
    string public uriSuffix;

    using StringsUpgradeable for uint256;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _rentalProtocol,
        address _originalNFT,
        string memory _uriPrefix,
        string memory _uriSuffix
    ) public initializer {
        __ERC721_init("Lent NFT", "lNFT");
        rentalProtocol = _rentalProtocol;
        originalNFT = ERC721Upgradeable(_originalNFT);
        uriPrefix = _uriPrefix;
        uriSuffix = _uriSuffix;
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
        return _generateSVG(tokenId);
    }

    /**
     * Constructs the encoded SVG string to be returned by tokenURI()
     */
    // solhint-disable quotes
    function _generateSVG(uint256 tokenId) internal view returns (string memory) {
        // solhint-disable-next-line quotes
        string memory originalImage = string(
            abi.encodePacked(
                '<image xlink:href="',
                uriPrefix,
                tokenId.toString(),
                uriSuffix,
                '" x="0" y="0" width="822" height="1092" />"'
            )
        );

        bytes memory image = abi.encodePacked(
            "data:image/svg+xml;base64,",
            Base64Upgradeable.encode(
                bytes(
                    abi.encodePacked(
                        '<?xml version="1.0" encoding="UTF-8"?>',
                        '<svg width="100%" height="100%" viewBox="0 0 822 1092" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
                        originalImage,
                        "<g>",
                        '<polygon points="500,13 500,57 550,57" style="fill: #3D60CE; filter: brightness(0.5);"/>',
                        '<polygon points="773,280 732,280 732,236" style="fill: #3D60CE; filter: brightness(0.5);"/>',
                        '<polygon points="600,13 773,180 773,280 500,13" style="fill: #3D60CE;"/>',
                        '<text x="0" y="0" dominant-baseline="middle" text-anchor="middle" style="fill: white; font-family: Arial; font-size: 28px; font-weight: bold; transform: translate(660px,125px) rotate(45deg);">Lent</text>',
                        "</g>",
                        "</svg>"
                    )
                )
            )
        );
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64Upgradeable.encode(
                        bytes(
                            abi.encodePacked(
                                '{"name":"Lent ',
                                originalNFT.symbol(),
                                " ",
                                tokenId.toString(),
                                '","description":"Lent ',
                                originalNFT.symbol(),
                                ' from Cometh Rental","animation_url":"',
                                image,
                                '"}'
                            )
                        )
                    )
                )
            );
    }
}
