
# Cometh Rental Protocol

## Context

The purpose of the Rental Protocol is to enable users to lend their ERC721 NFTs in a
trustless mode.

In Cometh games context, rentals allow to split the game rewards amongst multiple
parties involved in the rental.

## Features

### Rental Offers

In order to initiate a rental, a rental offer has to be created.

A rental offer can be seen as a bundle of NFTs available for rental (with duration and
percentage of rewards kept by the lender, for each NFT), an upfront rental cost, and a
deadline for the validity of this offer.

A rental offer can either be public or private.\
Private rental offer are restricted to a chosen tenant, by the lender.

A rental offer can either be created on-chain or off-chain.\
For on-chain offers, the offer is advertised via the `preSignRentalOffer` function.

> Until a rental starts the lender is still owning his NFTs.

### Rental

Users can browse through a list of rental offers.

> Even though a rental offer can be a bundle of multiple NFTs, a rental is always
  done on a per NFT basis.\
	Each rented NFT has a dedicated duration and rewards distribution.

When a tenant starts a rental (`rent` function), multiple actions are done:
- the protocol fee is sent to a Cometh wallet
  (5% of the upfront cost specified by the lender)
- the remaining upfront cost amount is sent to the lender
- the original NFTs are transferred to the rental protocol contract
- the lender receives a `LentNFT` per rented NFT,
  whose `tokenId` are the ones of the original NFTs
- the tenant receives a `BorrowedNFT` per rented NFT,
  whose `tokenId` are the ones of the original NFTs

> As `tokenId` are the same amongst all rental protocol NFTs, a player can either play
  with the original NFT or the `BorrowedNFT`.

A rental is usually terminated when its end date is reached.\
Either the lender or the tenant can end a rental, through the `endRental` function.

When a rental is ended:
- the lender gets back his original NFT
- the lender `LentNFT` is burnt
- the tenant `BorrowedNFT` is burnt

A rental can be ended before its end date if both the lender and tenant agrees to do
so.
> A rental sublet can't be ended prematuraly.

When the first party is willing to end prematurely a rental, he calls the
`endRentalPrematuraly` function. A `RequestToEndRentalPrematuraly` event is emitted.\
Then the second party can either ignore or accept this request by calling the
`endRentalPrematuraly` function.\
When a rental is ended prematurely the same process than the usual end rental workflow
is applied, except the check on the end date.

### Sublet

A tenant can sublet the borrowed NFTs to other users.

> The main purpose of this feature is to handle guilds use-cases allowing a guild
  manager to rent multiple NFTs and then sublet them to the guild players.

A sublet has no up-front cost and can be ended at any time by the sublender
(so the tenant from the rental).

The sublender can choose how many rewards percentage to keep to themselves and must
give the address of the subtenant (guild player).

When a sublet is done, multiple actions are done:
- the sublender transfers his `BorrowedNFT` to the subtenant
- the sublender is given a `SubLentNFT`, whose `tokenId` is the same as the
  `BorrowedNFT` one

In order to end a sublet, the subtenant calls the `endSublet` function.\
When doing so:
- the `SubLentNFT` is burnt
- the subtenant gets back the `BorrowedNFT`

### Recap of Rental Protocol NFTs
| Name          | Purpose
| ------------- | -------
| `LentNFT`     | Sent to a lender. Allows to reclaim the original NFT when rental ends
| `BorrowedNFT` | Sent to the party allowed to play as if he owned the original NFT
| `SubLentNFT`  | Sent to a sublender (if any).

### Matrix of allowed operations

#### Case 1 (without sublet)

|                 | `LentNFT` | `BorrowedNFT` |
| --------------- | :-------: | :-----------: |
| End Rental      | ✅        | ✅            |
| End Prematurely | ✅        | ✅            |
| Sublet          | ❌        | ✅            |
| End Sublet      | ❌        | ❌            |

#### Case 2 (with sublet)

|                 | `LentNFT` | `SubLentNFT` | `BorrowedNFT` |
|-----------------| :-------: | :----------: | :-----------: |
| End Rental      | ✅        | ✅           | ❌             |
| End Prematurely | ❌        | ❌           | ❌             |
| Sublet          | ❌        | ❌           | ❌             |
| End Sublet      | ❌        | ✅           | ❌             |

### Fees

Fees percentages are represented as basis points, from 0 to 10,000 (so 12.34% is the
value `1234`).


## Hardhat Tasks

### Distribute Rewards

`npx hardhat --network matic rental:distribute-rewards --borrowed-nft 0x3b55cd967d501C5FC7A7261fD108B6aefF6e4D48 --token-id 6000000 --amount 0.19`
