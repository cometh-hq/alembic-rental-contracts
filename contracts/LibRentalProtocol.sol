// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "./IRentalProtocol.sol";
import "./LentNFT.sol";
import "./BorrowedNFT.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";

struct LibRentalStorage {
    mapping(address => address) originalToLent;
    mapping(address => address) originalToBorrowed;
    mapping(bytes32 => IRentalProtocol.RentalOffer) offers;
    mapping(bytes32 => IRentalProtocol.Rental) rentals;
}

library LibRentalProtocol {
    using SafeERC20 for IERC20;

    uint64 public constant MAX_DISTRIBUTED_REWARDS = 10000;

    function createRentalOffer(LibRentalStorage storage self, bytes32 _offerId, IRentalProtocol.RentalOffer calldata offer, bytes calldata signature) public {
        address signer = ECDSA.recover(_offerId, signature);
        require(signer == offer.maker, "Signer is not maker");

        IERC721 token = IERC721(offer.token);
        LentNFT _lentNFT = LentNFT(self.originalToLent[offer.token]);
        // transfer NFTs to this contract
        for (uint256 i = 0; i < offer.tokenIds.length; i++) {
            uint256 _tokenId = offer.tokenIds[i];
            token.safeTransferFrom(signer, address(this), _tokenId);
            // mint LendNFT token
            _lentNFT.mint(signer, _tokenId);
        }
        // store offer
        self.offers[_offerId] = offer;
    }

    function acceptRentalOffer(
        LibRentalStorage storage self,
        bytes32 _offerId,
        bytes calldata signature,
        IERC20 feesToken,
        address feesCollector,
        uint256 feesPercentage
    ) public returns (IRentalProtocol.Rental memory) {
        IRentalProtocol.RentalOffer memory offer = self.offers[_offerId];
        address taker = ECDSA.recover(_offerId, signature);
        require(offer.distributedRewards <= MAX_DISTRIBUTED_REWARDS, "No more than 100% of rewards");

        // check if private rental offer and expected taker
        if (offer.taker != address(0x0)) {
            require(offer.taker == taker, "Rental: wrong tenant");
        }

        // add rental
        IRentalProtocol.Rental memory rental = IRentalProtocol.Rental({
            maker: offer.maker,
            taker: taker,
            token: offer.token,
            tokenIds: offer.tokenIds,
            start: block.timestamp,
            end: block.timestamp + offer.duration
        });
        self.rentals[_offerId] = rental;
        // remove rental offer
        delete self.offers[_offerId];
        // taker pays rental cost
        feesToken.safeTransferFrom(taker, rental.maker, offer.cost);
        // taker pays free
        uint256 fees = offer.cost * feesPercentage / 10000;
        feesToken.safeTransferFrom(taker, feesCollector, fees);
        // mint BorrowedNFT token
        BorrowedNFT _borrowedNFT = BorrowedNFT(self.originalToBorrowed[offer.token]);
        for (uint256 i = 0; i < offer.tokenIds.length; i++) {
            uint256 _tokenId = offer.tokenIds[i];
            _borrowedNFT.mint(taker, _tokenId, offer.maker, offer.distributedRewards);
        }
        return rental;
    }

    function endRentalOfferAtExpiry(LibRentalStorage storage self, bytes32 _offerId) public returns (IRentalProtocol.Rental memory) {
        IRentalProtocol.Rental memory rental = self.rentals[_offerId];
        require(msg.sender == rental.maker || msg.sender == rental.taker, "Rental: forbidden");
        require(block.timestamp >= rental.end, "Rental: rental hasn't expired");

        // burns `BorrowedNFT`s and `LentNFT`s and give back the original NFTs to the lender
        BorrowedNFT _borrowedNFT = BorrowedNFT(self.originalToBorrowed[rental.token]);
        LentNFT _lentNFT = LentNFT(self.originalToLent[rental.token]);
        IERC721 _originalNFT = IERC721(rental.token);
        for (uint256 i = 0; i < rental.tokenIds.length; i++) {
            uint256 _tokenId = rental.tokenIds[i];
            _borrowedNFT.burn(_tokenId);
            _lentNFT.burn(_tokenId);
            _originalNFT.safeTransferFrom(address(this), rental.maker, _tokenId);
        }
        delete self.rentals[_offerId];
        return rental;
    }

}