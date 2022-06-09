// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsSplitter {
    /**
     * @dev Two events like this one are emitted when a rental is sublet.
     * @param tokenId tokenId of the BorrowedNFT distributing rewards
     * @param lender address of the (sub)lender receiving the rewards
     * @param token address of the contract of the ERC20 rewards
     * @param amount amount of the rewards for the (sub)lender
     */
    event RewardsDistributed(uint256 indexed tokenId, address indexed lender, address indexed token, uint256 amount);

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
