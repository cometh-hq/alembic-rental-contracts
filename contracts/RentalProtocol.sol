// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "./IRentalProtocol.sol";
import "./LibRentalProtocol.sol";
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
    address public feesCollector;
    uint256 public feesPercentage;

    LibRentalStorage rentalStorage;

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
        LibRentalProtocol.createRentalOffer(rentalStorage, _offerId, offer, signature);
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
        Rental memory rental = LibRentalProtocol.acceptRentalOffer(rentalStorage, _offerId, signature, feesToken, feesCollector, feesPercentage);
        // advertise rental started
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

    function endRentalOfferAtExpiry(bytes32 _offerId) external override {
        Rental memory rental = LibRentalProtocol.endRentalOfferAtExpiry(rentalStorage, _offerId);
        // advertise rental finished
        emit IRentalProtocol.RentalFinished(
            _offerId,
            rental.maker,
            rental.taker,
            rental.token,
            rental.tokenIds,
            rental.start,
            rental.end
        );
    }

    function originalToLent(address _token) external view returns (address) {
        return rentalStorage.originalToLent[_token];
    }

    function originalToBorrowed(address _token) external view returns (address) {
        return rentalStorage.originalToBorrowed[_token];
    }

    function rentals(bytes32 _offerId) external view returns (Rental memory) {
        return rentalStorage.rentals[_offerId];
    }

    function whitelist(
        address _token,
        address _lentToken,
        address _borrowedToken
    ) external override onlyRole(WHITELISTER_ROLE) {
        if (rentalStorage.originalToLent[_token] == address(0x0)) {
            rentalStorage.originalToLent[_token] = _lentToken;
            rentalStorage.originalToBorrowed[_token] = _borrowedToken;
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
        require(rentalStorage.originalToLent[_token] != address(0x0), "Token not whitelisted");
        _;
    }
}
