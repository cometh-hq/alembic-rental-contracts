// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "./IRentalProtocol.sol";
import "./LentNFT.sol";
import "./BorrowedNFT.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract RentalProtocol is IRentalProtocol, AccessControl, ERC721Holder, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");
    bytes32 public constant FEES_MANAGER_ROLE = keccak256("FEES_MANAGER_ROLE");

    string public constant SIGNING_DOMAIN = "Cometh-Rental";
    string public constant SIGNATURE_VERSION = "1";

    IERC20 public feesToken;
    address feesCollector;
    uint256 feesPercentage;
    mapping(address => address) public originalToLent;
    mapping(address => address) public originalToBorrowed;
    mapping(bytes32 => RentalOffer) public offers;
    mapping(bytes32 => Rental) public rentals;

    constructor(address _feesToken, address _feesCollector, uint256 _feesPercentage) EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(WHITELISTER_ROLE, msg.sender);
        _setupRole(FEES_MANAGER_ROLE, msg.sender);
        feesToken = IERC20(_feesToken);
        feesCollector = _feesCollector;
        setFeesPercentage(_feesPercentage);
    }

    function createRentalOffer(RentalOffer calldata offer, bytes calldata signature)
        external
        override
        onlyWhitelistedToken(offer.token)
    {
        bytes32 _offerId = offerId(offer);
        address signer = ECDSA.recover(_offerId, signature);
        require(signer == offer.maker, "Signer is not maker");

        IERC721 token = IERC721(offer.token);
        LentNFT _lentNFT = LentNFT(originalToLent[offer.token]);
        // transfer NFTs to this contract
        for (uint256 i = 0; i < offer.tokenIds.length; i++) {
            uint256 _tokenId = offer.tokenIds[i];
            token.safeTransferFrom(msg.sender, address(this), _tokenId);
            // mint LendNFT token
            _lentNFT.mint(msg.sender, _tokenId);
        }
        // store offer
        offers[_offerId] = offer;
        // advertise offer
        emit RentalOfferCreated(
            _offerId,
            offer.maker,
            offer.taker,
            offer.token,
            offer.tokenIds,
            offer.duration,
            offer.cost
        );
    }

    function acceptRentalOffer(bytes32 _offerId, bytes calldata signature) external override {
        RentalOffer memory offer = offers[_offerId];
        address taker = ECDSA.recover(_offerId, signature);

        // add rental
        Rental memory rental = Rental({
            maker: offer.maker,
            taker: taker,
            token: offer.token,
            tokenIds: offer.tokenIds,
            start: block.timestamp,
            end: block.timestamp + offer.duration
        });
        rentals[_offerId] = rental;
        // remove rental offer
        delete offers[_offerId];
        // taker pays rental cost
        feesToken.safeTransferFrom(taker, rental.maker, offer.cost);
        // taker pays free
        uint256 fees = offer.cost * feesPercentage / 10000;
        feesToken.safeTransferFrom(taker, feesCollector, fees);
        // mint BorrowedNFT token
        BorrowedNFT _borrowedNFT = BorrowedNFT(originalToBorrowed[offer.token]);
        for (uint256 i = 0; i < offer.tokenIds.length; i++) {
            uint256 _tokenId = offer.tokenIds[i];
            _borrowedNFT.mint(msg.sender, _tokenId);
        }
        // advertise offer
        emit RentalStarted(
            _offerId,
            rental.maker,
            rental.taker,
            rental.token,
            rental.tokenIds,
            rental.start,
            rental.end
        );
    }

    function whitelist(
        address _token,
        address _lentToken,
        address _borrowedToken
    ) external override onlyRole(WHITELISTER_ROLE) {
        if (originalToLent[_token] == address(0x0)) {
            originalToLent[_token] = _lentToken;
            originalToBorrowed[_token] = _borrowedToken;
            emit TokenWhitelisted(_token);
        }
    }

    /**
     * @dev 5.12% would be the value 512.
     */
    function setFeesPercentage(uint256 _feesPercentage) public onlyRole(FEES_MANAGER_ROLE) {
        feesPercentage = _feesPercentage;
    }

    function offerId(RentalOffer calldata offer) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        keccak256("RentalOffer(address token,uint256[] tokenIds,uint64 duration,uint256 cost)"),
                        offer.token,
                        keccak256(abi.encodePacked(offer.tokenIds)),
                        offer.duration,
                        offer.cost
                    )
                )
            );
    }

    function getChainID() external view returns (uint256) {
        uint256 id;
        assembly {
            id := chainid()
        }
        return id;
    }

    modifier onlyWhitelistedToken(address _token) {
        require(originalToLent[_token] != address(0x0), "Token not whitelisted");
        _;
    }
}
