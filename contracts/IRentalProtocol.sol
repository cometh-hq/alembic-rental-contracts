// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

/**
 * @title Rental Protocol
 *
 * @notice A rental can only begin when a `RentalOffer` has been created either on-chain (`preSignRentalOffer`)
 * or off-chain. When a rental is started (`rent`), a `LentNFT` and `BorrowedNFT` are minted and given
 * respectively to the lender and the tenant. A rental can be also sublet to a specific borrower, at the
 * choosing of the tenant.
 *
 *
 * Rental NFTs:
 * - `LentNFT`: anyone having one can reclaim the original NFT at the end of the rental
 * - `BorrowedNFT`: allowed the tenant to play the game and earn some rewards as if he owned the original NFT
 * - `SubLentNFT`: a sublender is given this NFT in order to reclaim the `BorrowedNFT` when the sublet ends
 */
interface IRentalProtocol {
    enum SignatureType {
        PRE_SIGNED,
        EIP_712,
        EIP_1271
    }

    struct RentalOffer {
        /// address of the user renting his NFTs
        address maker;
        /// address of the allowed tenant if private rental or `0x0` if public rental
        address taker;
        /// NFTs included in this rental offer
        NFT[] nfts;
        /// address of the ERC20 token for rental fees
        address feeToken;
        /// amount of the rental fee
        uint256 feeAmount;
        /// nonce
        uint256 nonce;
        /// until when the rental offer is valid
        uint256 deadline;
    }

    struct NFT {
        /// address of the contract of the NFT to rent
        address token;
        /// specific NFT to be rented
        uint256 tokenId;
        /// how long the rent should be
        uint64 duration;
        /// percentage of rewards for the lender, in basis points format
        uint16 basisPoints;
    }

    struct Fee {
        // fee collector
        address to;
        /// percentage of rewards for the lender or sublender, in basis points format
        uint256 basisPoints;
    }

    /**
     * @param nonce nonce of the rental offer
     * @param maker address of the user renting his NFTs
     * @param taker address of the allowed tenant if private rental or `0x0` if public rental
     * @param nfts details about each NFT included in the rental offer
     * @param feeToken address of the ERC20 token for rental fees
     * @param feeAmount amount of the upfront rental cost
     * @param deadline until when the rental offer is valid
     */
    event RentalOfferCreated(
        uint256 indexed nonce,
        address indexed maker,
        address taker,
        NFT[] nfts,
        address feeToken,
        uint256 feeAmount,
        uint256 deadline
    );
    /**
     * @param nonce nonce of the rental offer
     * @param maker address of the user renting his NFTs
     */
    event RentalOfferCancelled(uint256 indexed nonce, address indexed maker);

    /**
     * @param nonce nonce of the rental offer
     * @param lender address of the lender
     * @param tenant address of the tenant
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     * @param duration how long the NFT is rented
     * @param basisPoints percentage of rewards for the lender, in basis points format
     * @param start when the rent begins
     * @param end when the rent ends
     */
    event RentalStarted(
        uint256 indexed nonce,
        address indexed lender,
        address indexed tenant,
        address token,
        uint256 tokenId,
        uint64 duration,
        uint16 basisPoints,
        uint256 start,
        uint256 end
    );
    /**
     * @param lender address of the lender
     * @param tenant address of the tenant
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    event RentalEnded(address indexed lender, address indexed tenant, address token, uint256 tokenId);

    /**
     * @param lender address of the lender
     * @param tenant address of the tenant
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     * @param basisPoints percentage of rewards for the sublender, in basis points format
     */
    event SubletStarted(
        address indexed lender,
        address indexed tenant,
        address token,
        uint256 tokenId,
        uint16 basisPoints
    );
    /**
     * @param lender address of the lender
     * @param tenant address of the tenant
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    event SubletEnded(address indexed lender, address indexed tenant, address token, uint256 tokenId);

    /**
     * @param requester address of the first party (lender or tenant) requesting to end the rental prematurely
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    event RequestToEndRentalPrematurely(address indexed requester, address indexed token, uint256 indexed tokenId);

    /**
     * @notice Link `originalNFT` to `lentNFT`, `borrowedNFT` and `subLentNFT`.
     * @param originalNFT address of the contract of the NFT to rent
     * @param lentNFT address of the `LentNFT` contract associated to `originalNFT`
     * @param borrowedNFT address of the `BorrowedNFT` contract associated to `originalNFT`
     * @param subLentNFT address of the `SubLentNFT` contract associated to `originalNFT`
     */
    event AssociatedNFTs(address originalNFT, address lentNFT, address borrowedNFT, address subLentNFT);

    event FeesCollectorChanged(address feeCollector);
    event FeesBasisPointsChanged(uint16 basisPoints);

    /**
     * @notice Create a new on-chain rental offer.
     * @notice In order to create a private offer, specify the `taker` address, otherwise use the `0x0` address
     * @dev When using pre-signed order, pass `SignatureType.PRE_SIGNED` as the `signatureType` for `rent`
     * @param offer the rental offer to store on-chain
     */
    function preSignRentalOffer(RentalOffer calldata offer) external;

    /**
     * @notice Cancel an on-chain rental offer.
     * @param nonce the nonce of the rental offer to cancel
     */
    function cancelRentalOffer(uint256 nonce) external;

    /**
     * @notice Start a rental between the `offer.maker` and `offer.taker`.
     * @param offer the rental offer
     * @param signatureType the signature type
     * @param signature optional signature when using `SignatureType.EIP_712` or `SignatureType.EIP_1271`
     * @dev `SignatureType.EIP_1271` is not yet supported, call will revert
     */
    function rent(
        RentalOffer calldata offer,
        SignatureType signatureType,
        bytes calldata signature
    ) external;

    /**
     * @notice End a rental when its duration is over.
     * @dev A rental can only be ended by the lender or the tenant.
     *      If there is a sublet it will be automatically ended.
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    function endRental(address token, uint256 tokenId) external;

    /**
     * @notice End a rental *before* its duration is over.
     *         Doing so need both the lender and the tenant to call this function.
     * @dev If there is an ongoing sublet the call will revert.
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    function endRentalPrematurely(address token, uint256 tokenId) external;

    /**
     * @notice Sublet a rental.
     * @dev Only a single sublet depth is allowed.
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     * @param subtenant address of whom the sublet is done for
     * @param basisPoints how many basis points the tenant keeps
     */
    function sublet(
        address token,
        uint256 tokenId,
        address subtenant,
        uint16 basisPoints
    ) external;

    /**
     * @notice End a sublet. Can be called by the tenant / sublender at any time.
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     */
    function endSublet(address token, uint256 tokenId) external;

    /**
     * Fees table for a given `token` and `tokenId`.
     *
     * `pencentage` is not based on the rewards to be distributed, but the what these
     * specific users keeps for themselves.
     * If lender keeps 30% and tenant keeps 20%, the 20% are 20% of the remaining 70%.
     * This is stored as `3000` and `2000` and maths should be done accordingly at
     * rewarding time.
     *
     * @param token address of the contract of the NFT rented
     * @param tokenId tokenId of the rented NFT
     * @return fees table
     */
    function getFeesTable(address token, uint256 tokenId) external view returns (Fee[] memory);

    /**
     * @notice Set the address which will earn protocol fees.
     * @param feesCollector address collecting protocol fees
     */
    function setFeesCollector(address feesCollector) external;

    /**
     * @notice Set the protocol fee percentage as basis points.
     * @param basisPoints percentage of the protocol fee
     */
    function setFeesBasisPoints(uint16 basisPoints) external;
}
