// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsSplitter {
    /**
     * On rewards received, split them according to fees table of this NFT.
     *
     * @dev expects the rewards to be sent to this contract
     */
    function onERC20Received(
        uint256 tokenId,
        address token,
        uint256 amount
    ) external returns (bytes4);
}
