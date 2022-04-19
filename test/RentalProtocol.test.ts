import { deployments, network, ethers } from "hardhat";
import { BigNumber } from "ethers";
import { TypedDataDomain, TypedDataField } from "@ethersproject/abstract-signer";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { RentalProtocol, IRentalProtocol } from "../artifacts/typechain/contracts/RentalProtocol";
import { LentNFT } from "../artifacts/typechain/contracts/LentNFT";
import { BorrowedNFT } from "../artifacts/typechain/contracts/BorrowedNFT";
import { ERC721Test } from "../artifacts/typechain/contracts/test/ERC721Test";
import { ERC20Test } from "../artifacts/typechain/contracts/test/ERC20Test";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

chai.use(solidity);
const { expect } = chai;
const FEE_PERCENTAGE = 500; // 5%
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

describe("RentalProtocol", () => {
  let rp: RentalProtocol;
  let erc721: ERC721Test;
  let lentNFT: LentNFT;
  let borrowedNFT: BorrowedNFT;
  let feesToken: ERC20Test;
  let admin: SignerWithAddress;
  let feesCollector: SignerWithAddress;
  let lender: SignerWithAddress;
  let tenant: SignerWithAddress;
  let subtenant: SignerWithAddress;
  let chainId: any;

  beforeEach(async () => {
    [admin, feesCollector, lender, tenant, subtenant] = await ethers.getSigners(); 

    // deploy fake ERC721 token
    const ERC721Test = await ethers.getContractFactory("ERC721Test");
    erc721 = await ERC721Test.deploy().then((c) => c.deployed()) as ERC721Test;

    // deploy fake fees token
    const ERC20Test = await ethers.getContractFactory("ERC20Test");
    feesToken = await ERC20Test.deploy().then((c) => c.deployed()) as ERC20Test;

    // deploy rental protocol    
    const RentalProtocol = await ethers.getContractFactory("RentalProtocol");
    rp = await RentalProtocol.deploy(feesToken.address, feesCollector.address, FEE_PERCENTAGE).then((c) => c.deployed()) as RentalProtocol;
    expect(rp.address).to.properAddress;

    // deploy LentNFT token
    const LentNFT = await ethers.getContractFactory("LentNFT");
    lentNFT = await LentNFT.deploy().then((c) => c.deployed()) as LentNFT;
    await lentNFT.grantRole(await lentNFT.MINTER_ROLE(), rp.address);
    // deploy BorrowedNFT token
    const BorrowedNFT = await ethers.getContractFactory("BorrowedNFT");
    borrowedNFT = await BorrowedNFT.deploy().then((c) => c.deployed()) as BorrowedNFT;
    await borrowedNFT.grantRole(await borrowedNFT.MINTER_ROLE(), rp.address);

    chainId = await rp.getChainID();
  });

  describe("Renting offers", () => {
    it("should create rental offer made of 1 NFT", async () => {
      const MINT_ID = 123;

      // admin whitelists ERC721 token
      await rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address);

      // mint some ERC721 for renting offer
      await erc721.mint(lender.address, MINT_ID);
      expect(await erc721.balanceOf(lender.address)).to.equal(1);

      // approve rental protocol contract to spend the NFTs
      await erc721.connect(lender).approve(rp.address, MINT_ID);

      // create rental offer, signed by the lender
      const duration = 24 * 60 * 60;
      const cost = ethers.utils.parseEther("1");
      const offer: IRentalProtocol.RentalOfferStruct = {
        maker: lender.address,
        taker: ZERO_ADDR,
        token: erc721.address,
        tokenIds: [MINT_ID],
        duration, // 24 hours
        cost,
      };
      const offerId = await rp.offerId(offer);
      const signature = await signRentalOrder(lender, offer);
      await expect(rp.connect(lender).createRentalOffer(offer, signature))
        // should emit RentalOfferCreated event
        .to.emit(rp, 'RentalOfferCreated')
        .withArgs(offerId, lender.address, ZERO_ADDR, erc721.address, [MINT_ID], duration, cost)
        // should transfer original NFT
        .to.emit(erc721, 'Transfer')
        .withArgs(lender.address, rp.address, MINT_ID)
        // should mint a LentNFT 
        .to.emit(lentNFT, 'Transfer')
        .withArgs(ZERO_ADDR, lender.address, MINT_ID);

      expect(await erc721.balanceOf(rp.address)).to.equal(1);
    });

    it("should create rental offer made of 5 NFTs", async () => {
      const MINT_IDS = [123, 234, 345, 456, 567];

      // admin whitelists ERC721 token
      await rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address);

      // mint some ERC721 for renting offer
      await Promise.all(MINT_IDS.map((tokenID) => erc721.mint(lender.address, tokenID)));
      expect(await erc721.balanceOf(lender.address)).to.equal(MINT_IDS.length);

      // approve rental protocol contract to spend the NFTs
      await Promise.all(MINT_IDS.map((tokenID) => erc721.connect(lender).approve(rp.address, tokenID)));

      // create rental offer, signed by the lender
      const duration = 24 * 60 * 60;
      const cost = ethers.utils.parseEther("1");
      const offer: IRentalProtocol.RentalOfferStruct = {
        maker: lender.address,
        taker: ZERO_ADDR,
        token: erc721.address,
        tokenIds: MINT_IDS,
        duration, // 24 hours
        cost,
      };
      const offerId = await rp.offerId(offer);
      const signature = await signRentalOrder(lender, offer);
      await expect(rp.connect(lender).createRentalOffer(offer, signature))
        // should emit RentalOfferCreated event
        .to.emit(rp, 'RentalOfferCreated')
        .withArgs(offerId, lender.address, ZERO_ADDR, erc721.address, MINT_IDS, duration, cost)
        // should transfer original NFTs
        .to.emit(erc721, 'Transfer').withArgs(lender.address, rp.address, MINT_IDS[0])
        .to.emit(erc721, 'Transfer').withArgs(lender.address, rp.address, MINT_IDS[1])
        .to.emit(erc721, 'Transfer').withArgs(lender.address, rp.address, MINT_IDS[2])
        .to.emit(erc721, 'Transfer').withArgs(lender.address, rp.address, MINT_IDS[3])
        .to.emit(erc721, 'Transfer').withArgs(lender.address, rp.address, MINT_IDS[4])
        // should mint 5 LentNFT
        .to.emit(lentNFT, 'Transfer').withArgs(ZERO_ADDR, lender.address, MINT_IDS[0])
        .to.emit(lentNFT, 'Transfer').withArgs(ZERO_ADDR, lender.address, MINT_IDS[1])
        .to.emit(lentNFT, 'Transfer').withArgs(ZERO_ADDR, lender.address, MINT_IDS[2])
        .to.emit(lentNFT, 'Transfer').withArgs(ZERO_ADDR, lender.address, MINT_IDS[3])
        .to.emit(lentNFT, 'Transfer').withArgs(ZERO_ADDR, lender.address, MINT_IDS[4]);

      expect(await erc721.balanceOf(rp.address)).to.equal(MINT_IDS.length);
    });

    it("should reject an rental offer on a non whitelisted NFT", async () => {
      const MINT_ID = 123;

      // mint some ERC721 for renting offer
      await erc721.mint(lender.address, MINT_ID);
      expect(await erc721.balanceOf(lender.address)).to.equal(1);

      // approve rental protocol contract to spend the NFTs
      await erc721.connect(lender).approve(rp.address, MINT_ID);

      // create rental offer, signed by the lender
      const duration = 24 * 60 * 60;
      const cost = ethers.utils.parseEther("1");
      const offer: IRentalProtocol.RentalOfferStruct = {
        maker: lender.address,
        taker: ZERO_ADDR,
        token: erc721.address,
        tokenIds: [MINT_ID],
        duration, // 24 hours
        cost,
      };
      const signature = await signRentalOrder(lender, offer);
      await expect(rp.connect(lender).createRentalOffer(offer, signature))
        .to.be.revertedWith("Token not whitelisted");
    });

    it("should create renting a offer accepted by a tenant", async () => {
      const MINT_ID = 123;

      // admin whitelists ERC721 token
      await rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address);

      // mint some ERC721 for renting offer
      await erc721.mint(lender.address, MINT_ID);
      expect(await erc721.balanceOf(lender.address)).to.equal(1);

      // approve rental protocol contract to spend the NFTs
      await erc721.connect(lender).approve(rp.address, MINT_ID);

      // create rental offer, signed by the lender
      const duration = 24 * 60 * 60;
      const cost = ethers.utils.parseEther("1");
      const offer: IRentalProtocol.RentalOfferStruct = {
        maker: lender.address,
        taker: ZERO_ADDR,
        token: erc721.address,
        tokenIds: [MINT_ID],
        duration, // 24 hours
        cost,
      };
      const offerId = await rp.offerId(offer);
      const lenderSignature = await signRentalOrder(lender, offer);
      await expect(rp.connect(lender).createRentalOffer(offer, lenderSignature))
        // should emit RentalOfferCreated event
        .to.emit(rp, 'RentalOfferCreated')
        .withArgs(offerId, lender.address, ZERO_ADDR, erc721.address, [MINT_ID], duration, cost)
        // should transfer original NFT
        .to.emit(erc721, 'Transfer')
        .withArgs(lender.address, rp.address, MINT_ID)
        // should mint a LentNFT 
        .to.emit(lentNFT, 'Transfer')
        .withArgs(ZERO_ADDR, lender.address, MINT_ID);
      expect(await erc721.balanceOf(rp.address)).to.equal(1);

      // mint some fake fee tokens for tenant
      const totalCost = cost.mul(ethers.utils.parseEther((1 + (FEE_PERCENTAGE / 10000).toString())));
      await feesToken.mint(tenant.address, totalCost);
      // approve rental protocol to spend them
      await feesToken.connect(tenant).approve(rp.address, totalCost);
      // tenant picks offer
      const tenantSignature = await signRentalOrder(tenant, offer);
      const start = Date.now() + 5;
      await network.provider.send("evm_setNextBlockTimestamp", [start]);
      const end = start + BigNumber.from(offer.duration).toNumber();
      await expect(rp.connect(tenant).acceptRentalOffer(offerId, tenantSignature))
        // should emit RentalStarted event
        .to.emit(rp, 'RentalStarted')
        .withArgs(offerId, lender.address, tenant.address, erc721.address, [MINT_ID], start, end)
        // should mint a BorrowedNFT to the tenant
        .to.emit(borrowedNFT, 'Transfer')
        .withArgs(ZERO_ADDR, tenant.address, MINT_ID)
        // should transfer rental cost to lender
        .to.emit(feesToken, 'Transfer')
        .withArgs(tenant.address, lender.address, cost)
        // should transfer rental fees to fees collector
        .to.emit(feesToken, 'Transfer')
        .withArgs(tenant.address, feesCollector.address, ethers.utils.parseEther("0.05"));
    });

    it("should create renting a offer and fail to accept by a tenant lacking enough to cover cost", async () => {
      const MINT_ID = 123;

      // admin whitelists ERC721 token
      await rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address);

      // mint some ERC721 for renting offer
      await erc721.mint(lender.address, MINT_ID);
      expect(await erc721.balanceOf(lender.address)).to.equal(1);

      // approve rental protocol contract to spend the NFTs
      await erc721.connect(lender).approve(rp.address, MINT_ID);

      // create rental offer, signed by the lender
      const duration = 24 * 60 * 60;
      const cost = ethers.utils.parseEther("1");
      const offer: IRentalProtocol.RentalOfferStruct = {
        maker: lender.address,
        taker: ZERO_ADDR,
        token: erc721.address,
        tokenIds: [MINT_ID],
        duration, // 24 hours
        cost,
      };
      const offerId = await rp.offerId(offer);
      const lenderSignature = await signRentalOrder(lender, offer);
      await expect(rp.connect(lender).createRentalOffer(offer, lenderSignature))
        // should emit RentalOfferCreated event
        .to.emit(rp, 'RentalOfferCreated')
        .withArgs(offerId, lender.address, ZERO_ADDR, erc721.address, [MINT_ID], duration, cost)
        // should transfer original NFT
        .to.emit(erc721, 'Transfer')
        .withArgs(lender.address, rp.address, MINT_ID)
        // should mint a LentNFT 
        .to.emit(lentNFT, 'Transfer')
        .withArgs(ZERO_ADDR, lender.address, MINT_ID);
      expect(await erc721.balanceOf(rp.address)).to.equal(1);

      // mint some fake fee tokens for tenant
      await feesToken.mint(tenant.address, cost.sub(BigNumber.from("1")));
      // approve rental protocol to spend them
      await feesToken.connect(tenant).approve(rp.address, cost);
      // tenant picks offer
      const tenantSignature = await signRentalOrder(tenant, offer);
      await expect(rp.connect(tenant).acceptRentalOffer(offerId, tenantSignature))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Whitelisting", () => {
    it("should only allow to whitelist when having WHITELISTER role", async () => {
      // user lacking proper role should not be able to whitelist or revoke
      await expect(rp.connect(lender).whitelist(erc721.address, lentNFT.address, borrowedNFT.address))
        .to.be.revertedWith(`AccessControl: account ${lender.address.toLocaleLowerCase()} is missing role ${await rp.WHITELISTER_ROLE()}`);
      // admin whitelists ERC721 token
      await rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address);
      const lentNftAddress = await rp.originalToLent(erc721.address);
      const lentNft: LentNFT = await ethers.getContractAt('LentNFT', lentNftAddress);
      expect(lentNft.address).to.be.properAddress;
    });

    it("should allow the same token to be whitelisted twice", async () => {
      await expect(rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address))
        .to.emit(rp, 'TokenWhitelisted')
        .withArgs(erc721.address);
      let lentNftAddress = await rp.originalToLent(erc721.address);
      let lentNft: LentNFT = await ethers.getContractAt('LentNFT', lentNftAddress);
      expect(lentNft.address).to.be.properAddress;

      await expect(rp.whitelist(erc721.address, lentNFT.address, borrowedNFT.address))
        .to.not.emit(rp, 'TokenWhitelisted')
        .withArgs(erc721.address);
      lentNftAddress = await rp.originalToLent(erc721.address);
      lentNft = await ethers.getContractAt('LentNFT', lentNftAddress);
      expect(lentNft.address).to.be.properAddress;
    });
  });

  describe("Fees", () => {
    it("should only allow to changes fees percentage when having FEES_MANAGER role", async () => {
      // user lacking proper role should not be able to changes fees percentage
      await expect(rp.connect(lender).setFeesPercentage(700))
        .to.be.revertedWith(`AccessControl: account ${lender.address.toLocaleLowerCase()} is missing role ${await rp.FEES_MANAGER_ROLE()}`);
      // admin changes fees percentage
      await rp.setFeesPercentage(700);
    });
  });

  const signRentalOrder = async(user: SignerWithAddress, offer: IRentalProtocol.RentalOfferStruct) => {
    const name = await rp.SIGNING_DOMAIN();
    const version = await rp.SIGNATURE_VERSION();
    const domain: TypedDataDomain = { name, version, chainId, verifyingContract: rp.address };
    const types: Record<string, Array<TypedDataField>> = {
      RentalOffer: [
        { name: "token", type: "address" },
        { name: "tokenIds", type: "uint256[]" },
        { name: "duration", type: "uint64" },
        { name: "cost", type: "uint256" },
      ],
    }
    return user._signTypedData(domain, types, offer);
  }

});
