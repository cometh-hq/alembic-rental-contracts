// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC20Test is ERC20Burnable {
    constructor() ERC20("Test", "TEST") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
