// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC1155/presets/ERC1155PresetMinterPauser.sol";

contract ERC1155Test is ERC1155PresetMinterPauser {
    constructor(string memory uri) ERC1155PresetMinterPauser(uri) {}
}
