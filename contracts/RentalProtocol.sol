// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./IRentalProtocol.sol";
import "./LentNFT.sol";
import "./BorrowedNFT.sol";
import "./SubLentNFT.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

// solhint-disable not-rely-on-time
contract RentalProtocol is
    IRentalProtocol,
    Initializable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC721HolderUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint16 public constant MAX_BASIS_POINTS = 100_00;

    /// @dev nonce => isPresigned
    mapping(bytes32 => bool) public preSignedOffer;

    /// @dev maker => nonce => bool
    mapping(address => mapping(uint256 => bool)) public invalidNonce;

    /// @dev token => tokenId => rental
    mapping(address => mapping(uint256 => Rental)) public rentals;

    struct Rental {
        uint256 end;
        uint256 lenderFee;
        uint256 sublenderFee;
    }

    mapping(address => LentNFT) public originalToLentNFT;
    mapping(address => BorrowedNFT) public originalToBorrowedNFT;
    mapping(address => SubLentNFT) public originalToSubLendNFT;

    // token => tokenId => (lender or tenant)
    mapping(address => mapping(uint256 => address)) public endRentalPrematurelyRequests;

    address public feesCollector;
    uint16 public protocolFeeBasisPoints;

    bytes32 public constant TOKENS_MANAGER_ROLE = keccak256("TOKENS_MANAGER_ROLE");
    bytes32 public constant FEES_MANAGER_ROLE = keccak256("FEES_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    string public constant SIGNING_DOMAIN = "Cometh-Rental";
    string public constant SIGNATURE_VERSION = "1";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _feesCollector, uint16 feesBasisPoints) public initializer {
        __Pausable_init();
        __AccessControl_init();
        __ERC721Holder_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);
        __ReentrancyGuard_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
        _setupRole(TOKENS_MANAGER_ROLE, msg.sender);
        _setupRole(FEES_MANAGER_ROLE, msg.sender);
        setFeesCollector(_feesCollector);
        setFeesBasisPoints(feesBasisPoints);
    }

    function preSignRentalOffer(RentalOffer calldata offer) external override whenNotPaused {
        require(offer.maker == msg.sender, "Signer and Maker mismatch");

        preSignedOffer[hashRentalOffer(offer)] = true;

        emit RentalOfferCreated(
            offer.nonce,
            offer.maker,
            offer.taker,
            offer.nfts,
            offer.feeToken,
            offer.feeAmount,
            offer.deadline
        );
    }

    function cancelRentalOffer(uint256 nonce) external override whenNotPaused {
        invalidNonce[msg.sender][nonce] = true;
        emit RentalOfferCancelled(nonce, msg.sender);
    }

    function rent(
        RentalOffer calldata offer,
        SignatureType signatureType,
        bytes calldata signature
    ) external override nonReentrant whenNotPaused {
        if (signatureType == SignatureType.PRE_SIGNED) {
            require(preSignedOffer[hashRentalOffer(offer)] == true, "Presigned offer not found");
        } else if (signatureType == SignatureType.EIP_712) {
            bytes32 _hash = hashRentalOffer(offer);
            address signer = ECDSAUpgradeable.recover(_hash, signature);
            require(signer == offer.maker, "Signer is not maker");
        } else {
            revert("Unsupported signature type");
        }

        require(invalidNonce[offer.maker][offer.nonce] == false, "cancelled or filled offer");
        require(block.timestamp <= offer.deadline, "Offer deadline");

        // mark as invalid to avoid a later rent for the same order
        invalidNonce[offer.maker][offer.nonce] = true;

        // if private rental, check if expected taker
        if (offer.taker != address(0x0)) {
            require(offer.taker == msg.sender, "Private rental");
        }

        // process each NFT
        for (uint256 i = 0; i < offer.nfts.length; i++) {
            NFT memory nft = offer.nfts[i];
            address token = nft.token;
            uint256 tokenId = nft.tokenId;
            uint16 basisPoints = nft.basisPoints;
            LentNFT lentNFT = originalToLentNFT[token];
            BorrowedNFT borrowedNFT = originalToBorrowedNFT[token];

            require(basisPoints <= MAX_BASIS_POINTS, "No more than 100% rewards");

            // transfer NFTs to this contract
            IERC721(nft.token).safeTransferFrom(offer.maker, address(this), tokenId);
            // mint LendNFT token
            lentNFT.mint(offer.maker, tokenId);
            // mint BorrowedNFT token
            borrowedNFT.mint(msg.sender, tokenId);

            Rental memory rental = Rental({
                end: block.timestamp + nft.duration,
                lenderFee: basisPoints,
                sublenderFee: 0
            });

            rentals[nft.token][tokenId] = rental;

            emit RentalStarted(
                offer.nonce,
                offer.maker,
                msg.sender,
                nft.token,
                nft.tokenId,
                nft.duration,
                basisPoints,
                block.timestamp,
                rental.end
            );
        }

        // process cost and fee if offer cost > 0
        if (offer.feeAmount > 0) {
            IERC20Upgradeable feeToken = IERC20Upgradeable(offer.feeToken);
            // taker pays the protocol fee
            uint256 fees = (offer.feeAmount * protocolFeeBasisPoints) / MAX_BASIS_POINTS;
            feeToken.safeTransferFrom(msg.sender, feesCollector, fees);
            // taker pays lender
            feeToken.safeTransferFrom(msg.sender, offer.maker, offer.feeAmount - fees);
        }
    }

    function sublet(
        address token,
        uint256 tokenId,
        address subtenant,
        uint16 basisPoints
    ) external override nonReentrant whenNotPaused {
        require(!subletExist(token, tokenId), "Can't sublet more than once");

        BorrowedNFT borrowedNFT = originalToBorrowedNFT[token];
        address tenant = borrowedNFT.ownerOf(tokenId);
        require(tenant == msg.sender, "Only tenant can sublet");
        require(basisPoints <= MAX_BASIS_POINTS, "No more than 100% rewards");

        rentals[token][tokenId].sublenderFee = basisPoints;

        SubLentNFT subLentNFT = originalToSubLendNFT[token];
        subLentNFT.mint(tenant, tokenId);
        borrowedNFT.transferFrom(msg.sender, subtenant, tokenId);

        emit SubletStarted(tenant, subtenant, token, tokenId, basisPoints);
    }

    function endRental(address token, uint256 tokenId) external override nonReentrant whenNotPaused {
        require(block.timestamp > rentals[token][tokenId].end, "Rental hasn't ended");
        _endRental(token, tokenId);
    }

    function endRentalPrematurely(address token, uint256 tokenId) external override nonReentrant whenNotPaused {
        LentNFT lentNFT = originalToLentNFT[token];
        address lender = lentNFT.ownerOf(tokenId);
        BorrowedNFT borrowedNFT = originalToBorrowedNFT[token];
        address tenant = borrowedNFT.ownerOf(tokenId);

        require(msg.sender == lender || msg.sender == tenant, "Only lender or tenant");
        require(subletExist(token, tokenId) == false, "Sublet not ended");

        address requester = endRentalPrematurelyRequests[token][tokenId];

        // ensure requester is still either the lender or tenant
        if (requester != lender && requester != tenant) {
            requester = address(0x0);
        }

        if (requester == address(0x0)) {
            // request to end rental prematuraly
            endRentalPrematurelyRequests[token][tokenId] = msg.sender;
            emit RequestToEndRentalPrematurely(msg.sender, token, tokenId);
        } else {
            // acceptance by the other party (lender or tenant)
            require(requester != address(0x0), "No previous request");
            // check this is the other party making the call
            require(msg.sender != requester, "Forbidden");
            // end rental
            _endRental(token, tokenId);
        }
    }

    function endSublet(address token, uint256 tokenId) external override nonReentrant whenNotPaused {
        require(subletExist(token, tokenId), "No sublet");

        SubLentNFT subLentNFT = originalToSubLendNFT[token];
        address subLender = subLentNFT.ownerOf(tokenId);
        require(msg.sender == subLender, "Only sub lender");

        _endSublet(token, tokenId);
    }

    function getFeesTable(address token, uint256 tokenId) external view override returns (Fee[] memory) {
        bool isSublet = subletExist(token, tokenId);
        uint256 feesCount = isSublet ? 2 : 1;
        Fee[] memory fees = new Fee[](feesCount);
        LentNFT lentNFT = originalToLentNFT[token];

        fees[0] = Fee({to: lentNFT.ownerOf(tokenId), basisPoints: rentals[token][tokenId].lenderFee});

        if (isSublet) {
            SubLentNFT subLentNFT = originalToSubLendNFT[token];
            fees[1] = Fee({to: subLentNFT.ownerOf(tokenId), basisPoints: rentals[token][tokenId].sublenderFee});
        }

        return fees;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function associateOriginalToLentAndBorrowedNFT(
        address originalNFT,
        address lentNFT,
        address borrowedNFT,
        address subLentNFT
    ) external {
        require(hasRole(TOKENS_MANAGER_ROLE, msg.sender), "TOKENS_MANAGER_ROLE only");
        originalToLentNFT[originalNFT] = LentNFT(lentNFT);
        originalToBorrowedNFT[originalNFT] = BorrowedNFT(borrowedNFT);
        originalToSubLendNFT[originalNFT] = SubLentNFT(subLentNFT);
        emit AssociatedNFTs(originalNFT, lentNFT, borrowedNFT, subLentNFT);
    }

    function setFeesCollector(address _feesCollector) public override {
        require(hasRole(FEES_MANAGER_ROLE, msg.sender), "FEES_MANAGER_ROLE only");
        feesCollector = _feesCollector;
        emit FeesCollectorChanged(_feesCollector);
    }

    function setFeesBasisPoints(uint16 basisPoints) public override {
        require(hasRole(FEES_MANAGER_ROLE, msg.sender), "FEES_MANAGER_ROLE only");
        protocolFeeBasisPoints = basisPoints;
        emit FeesBasisPointsChanged(basisPoints);
    }

    function hashRentalOffer(RentalOffer memory offer) public view returns (bytes32) {
        bytes32 nftsHash = hashNFTs(offer.nfts);

        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        keccak256(
                            "RentalOffer(address maker,address taker,NFT[] nfts,address feeToken,uint256 feeAmount,uint256 nonce,uint256 deadline)NFT(address token,uint256 tokenId,uint64 duration,uint16 basisPoints)"
                        ),
                        offer.maker,
                        offer.taker,
                        nftsHash,
                        offer.feeToken,
                        offer.feeAmount,
                        offer.nonce,
                        offer.deadline
                    )
                )
            );
    }

    /**
     * @dev low level function expecting proper requires from calling function
     */
    function _endRental(address token, uint256 tokenId) internal {
        LentNFT lentNFT = originalToLentNFT[token];
        address lender = lentNFT.ownerOf(tokenId);

        if (subletExist(token, tokenId)) {
            SubLentNFT subLentNFT = originalToSubLendNFT[token];
            address subLender = subLentNFT.ownerOf(tokenId);

            require(msg.sender == subLender || msg.sender == lender, "Only sublender or lender");

            _endSublet(token, tokenId);
        }

        BorrowedNFT borrowedNFT = originalToBorrowedNFT[token];
        address tenant = borrowedNFT.ownerOf(tokenId);

        require(msg.sender == lender || msg.sender == tenant, "Only lender or tenant");

        borrowedNFT.burn(tokenId);
        lentNFT.burn(tokenId);
        IERC721(token).transferFrom(address(this), lender, tokenId);

        // cleanup
        delete rentals[token][tokenId];
        delete endRentalPrematurelyRequests[token][tokenId];

        emit RentalEnded(lender, tenant, token, tokenId);
    }

    /**
     * @dev low level function expecting proper requires from calling function
     */
    function _endSublet(address token, uint256 tokenId) internal {
        SubLentNFT subLentNFT = originalToSubLendNFT[token];
        address subLender = subLentNFT.ownerOf(tokenId);

        BorrowedNFT borrowedNFT = originalToBorrowedNFT[token];
        address borrower = borrowedNFT.ownerOf(tokenId);
        borrowedNFT.transferFrom(borrower, subLender, tokenId);

        subLentNFT.burn(tokenId);

        emit SubletEnded(subLender, borrower, token, tokenId);
    }

    function subletExist(address token, uint256 tokenId) internal view returns (bool) {
        SubLentNFT subLentNFT = originalToSubLendNFT[token];
        return subLentNFT.exists(tokenId);
    }

    /// @dev keccak256("");
    bytes32 private constant _EMPTY_ARRAY_KECCAK256 =
        0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;

    function hashNFTs(NFT[] memory nfts) internal pure returns (bytes32 hash) {
        uint256 arrayLength = nfts.length;
        if (arrayLength == 0) {
            return _EMPTY_ARRAY_KECCAK256;
        }

        bytes32[] memory hashArray = new bytes32[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            hashArray[i] = keccak256(
                abi.encode(
                    keccak256("NFT(address token,uint256 tokenId,uint64 duration,uint16 basisPoints)"),
                    nfts[i].token,
                    nfts[i].tokenId,
                    nfts[i].duration,
                    nfts[i].basisPoints
                )
            );
        }
        // solhint-disable-next-line no-inline-assembly
        assembly {
            hash := keccak256(add(hashArray, 32), mul(arrayLength, 32))
        }
    }
}
