// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IRentalProtocol is IERC721Receiver {
    event RentalOfferCreated(
        bytes32 indexed offerId,
        address indexed maker,
        address taker,
        address indexed token,
        uint256[] tokenIds,
        uint64 duration,
        uint256 cost
    );
    event RentalStarted(
        bytes32 indexed rentalId,
        address indexed maker,
        address indexed taker,
        address token,
        uint256[] tokenIds,
        uint256 start,
        uint256 end
    );
    event RentalFinished(
        bytes32 indexed rentalId,
        address indexed maker,
        address indexed taker,
        address token,
        uint256[] tokenIds,
        uint256 start,
        uint256 end
    );
    event TokenWhitelisted(address indexed token);

    struct RentalOffer {
        /// address of the user renting is NFTs
        address maker;
        /// optional address of the allowed lender
        address taker;
        /// address of the contract of the NFT to rent
        address token;
        /// specific NFT to be rented
        uint256[] tokenIds;
        /// how long the rent should be
        uint64 duration;
        /// distributed rewards (betwen 0-100% as 0-10000 range)
        uint64 distributedRewards;
        /// cost
        uint256 cost;
        /// TODO: add expiry & nonce
    }

    struct Rental {
        /// address of the user renting is NFTs
        address maker;
        /// optional address of the allowed lender
        address taker;
        /// address of the contract of the NFT to rent
        address token;
        /// specific NFT to be rented
        uint256[] tokenIds;
        /// when the rental starts
        uint256 start;
        /// when the rental ends
        uint256 end;
        /// TODO: add expiry & nonce
    }

    /**
     * Create a rental offer.
     *
     * When doing so the offer's `maker` will transfer his NFTs to this contract and be
     * given some `lentToken` NFTs having the same `tokenId` as the original NFTs.
     *
     * @param offer the rental offer
     * @param signature EIP712 signature of the rental offer, by the lender, allowing a third party to submit this offer
     */
    function createRentalOffer(RentalOffer calldata offer, bytes calldata signature) external;

    /**
     * Accept a rental offer and start the rental.
     *
     * When doing so the offer's `maker` will transfer his NFTs to this contract and be
     * given some `lentToken` NFTs having the same `tokenId` as the original NFTs.
     *
     * @param offerId ID of the rental offer
     * @param signature EIP712 signature of the rental offer, by the tenant, allowing a third party to start the rental
     *
     * @dev `offerId` is the hash of the rental offer, as done before signing with EIP712
     */
    function acceptRentalOffer(bytes32 offerId, bytes calldata signature) external;

    /**
     * Ends a rental offer when the rental duration has elapsed.
     * @dev burns `BorrowedNFT`s and `LentNFT`s and give back the original NFTs to the lender
     */
    function endRentalOfferAtExpiry(bytes32 offerId) external;

    /**
     * Whitelist a NFT contract for rental.
     *
     * If a NFT contract is not whitelisted, all rental offers would be rejected.
     *
     * @param token the NFT token to whitelist
     * @param lentToken the NFT to distribute to the lender when a rental offer is created (see `LentNFT`)
     * @param borrowedToken the NFT to distributed to the borrower when a rental offer is accepted and verified (see `BorrowedNFT`)
     *
     * @dev this contract should be given the `MINTER_ROLE` on both `lentToken` and `borrowedToken`
     */
    function whitelist(
        address token,
        address lentToken,
        address borrowedToken
    ) external;
}
