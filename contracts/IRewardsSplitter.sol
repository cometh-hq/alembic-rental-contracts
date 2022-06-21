// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsSplitter {
    /**
     * @dev Up to three events like this one are emitted when a rental is sublet (one for lender, one for sublender, one for the player).
     * @param tokenId tokenId of the BorrowedNFT distributing rewards
     * @param recipient address of the recipient of the rewards
     * @param token address of the contract of the ERC20 rewards
     * @param amount amount of the rewards for the (sub)lender
     */
    event RewardsDistributed(uint256 indexed tokenId, address indexed recipient, address indexed token, uint256 amount);

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
