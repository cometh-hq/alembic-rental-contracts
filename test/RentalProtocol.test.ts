import { network, ethers, upgrades } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { RentalProtocol, IRentalProtocol, LentNFT, BorrowedNFT, SubLentNFT, ERC20Test, ERC721Test } from "../artifacts/typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { randomBytes } from "crypto";
import { BigNumberish } from "ethers";

chai.use(solidity);
const { expect } = chai;
const FEE_PERCENTAGE = 5_00; // 5%
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

describe("Rental", () => {
  let rp: RentalProtocol;
  let erc721: ERC721Test;
  let feesToken: ERC20Test;
  let lentNFT: LentNFT;
  let borrowedNFT: BorrowedNFT;
  let subLentNFT: SubLentNFT;
  let rewardsToken: ERC20Test;
  let admin: SignerWithAddress;
  let feesCollector: SignerWithAddress;
  let lender: SignerWithAddress;
  let anotherLender: SignerWithAddress;
  let tenant: SignerWithAddress;
  let anotherTenant: SignerWithAddress;
  let subtenant1: SignerWithAddress;
  let subtenant2: SignerWithAddress;

  enum SignatureType {
    PRE_SIGNED,
    EIP_712,
    EIP_1271
  }

  beforeEach(async () => {
    [admin, feesCollector, lender, anotherLender, tenant, anotherTenant, subtenant1, subtenant2] = await ethers.getSigners();

    // deploy fake ERC721 token
    const ERC721Test = await ethers.getContractFactory("ERC721Test");
    erc721 = await ERC721Test.deploy().then((c) => c.deployed()) as ERC721Test;

    // deploy fake fees token
    const ERC20Test = await ethers.getContractFactory("ERC20Test");
    feesToken = await ERC20Test.deploy().then((c) => c.deployed()) as ERC20Test;

    // deploy fake rewards token
    rewardsToken = await ERC20Test.deploy().then((c) => c.deployed()) as ERC20Test;

    // deploy rental protocol contract
		const RentalProtocol = await ethers.getContractFactory("RentalProtocol");
		rp = await upgrades.deployProxy(RentalProtocol, [feesCollector.address, FEE_PERCENTAGE]) as RentalProtocol;
		await rp.deployed();
    expect(rp.address).to.have.properAddress;

    // deploy LentNFT associated with erc721
    const LentNFT = await ethers.getContractFactory("LentNFT");
		lentNFT = await upgrades.deployProxy(LentNFT, [rp.address, erc721.address, "https://ipfs.io/", ".png"]) as LentNFT;
    // deploy BorrowedNFT associated with erc721
    const BorrowedNFT = await ethers.getContractFactory("BorrowedNFT");
		borrowedNFT = await upgrades.deployProxy(BorrowedNFT, [rp.address, erc721.address]) as BorrowedNFT;
    // deploy SubLentNFT associated with erc721
    const SubLentNFT = await ethers.getContractFactory("SubLentNFT");
		subLentNFT = await upgrades.deployProxy(SubLentNFT, [rp.address, erc721.address, "https://ipfs.io/", ".png"]) as SubLentNFT;

    // make RentalProtocol aware of these links
    await rp.associateOriginalToLentAndBorrowedNFT(erc721.address, lentNFT.address, borrowedNFT.address, subLentNFT.address);
  });

  describe("On-chain Rental Offers", () => {

    it("should create a rental offer", async () => {
      const offer = await createOffer(lender, erc721);
      const txCreateOffer = rp.connect(lender).preSignRentalOffer(offer);
      await expect(txCreateOffer)
        .to.emit(rp, 'RentalOfferCreated');
    });

    it("should start a rental", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await expect(txAcceptOffer).to.emit(rp, 'RentalStarted');
    });

    it("should cancel a rental offer", async () => {
      const nonce = `0x${randomBytes(32).toString('hex')}`;
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, nonce);
      await rp.connect(lender).preSignRentalOffer(offer);
      await expect(rp.connect(lender).cancelRentalOffer(offer.nonce))
        .to.emit(rp, 'RentalOfferCancelled').withArgs(nonce, lender.address);
    });

    it("should start a rental with MUST fee", async () => {
      const cost = ethers.utils.parseEther('10');
      // mint some MUST for the tenant
      await feesToken.mint(tenant.address, cost);
      await feesToken.connect(tenant).approve(rp.address, cost);
      // create offer
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`, cost);
      await rp.connect(lender).preSignRentalOffer(offer);
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await expect(txAcceptOffer)
				// 10 MUST - 5%
				.to.emit(feesToken, 'Transfer').withArgs(tenant.address, lender.address, ethers.utils.parseEther('9.5'))
				// 5% fee
				.to.emit(feesToken, 'Transfer').withArgs(tenant.address, feesCollector.address, ethers.utils.parseEther('0.5'))
				.to.emit(rp, 'RentalStarted');
    });

    it("should start a private rental", async () => {
      const offer = await createBundleOffer(lender, anotherTenant.address, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await expect(rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x")).to.be.revertedWith('Private rental');
      await expect(rp.connect(anotherTenant).rent(offer, SignatureType.PRE_SIGNED, "0x")).to.emit(rp, 'RentalStarted');
    });

  });

  describe("Off-chain Rental Offers", () => {
    it("should hash EIP712 Typed Structs", async () => {
      const domain = await getDomain(rp)
      const types = await getTypes()
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      const expectedHash = ethers.utils._TypedDataEncoder.hash(domain, types, offer)
      const actualHash = await rp.hashRentalOffer(offer)
      await expect(actualHash).to.equal(expectedHash)
    });

    it("should start a rental with EIP-712 signature", async () => {
      const domain = await getDomain(rp)
      const types = await getTypes()
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      const signature = await lender._signTypedData(domain, types as any, offer)
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.EIP_712, signature);
      await expect(txAcceptOffer).to.emit(rp, 'RentalStarted')
    });
  });

  describe("Rentals", () => {
    it("should sublet a rental", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;
      await expect(rp.connect(tenant).sublet(token, tokenId, subtenant1.address, 20_00))
        .to.emit(rp, 'SubletStarted').withArgs(tenant.address, subtenant1.address, token, tokenId, 20_00)
        .to.emit(borrowedNFT, 'Transfer').withArgs(tenant.address, subtenant1.address, tokenId);
    });

    it("should end a sublet", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      await rp.connect(tenant).sublet(token, tokenId, subtenant1.address, 20_00)

      await expect(rp.connect(tenant).endSublet(token, tokenId))
        .to.emit(rp, 'SubletEnded').withArgs(tenant.address, subtenant1.address, token, tokenId)
        .to.emit(borrowedNFT, 'Transfer').withArgs(subtenant1.address, tenant.address, tokenId)
        .to.emit(subLentNFT, 'Transfer').withArgs(tenant.address, ZERO_ADDR, tokenId)
    });

    it("should end rental", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");

      await network.provider.send("evm_increaseTime", [(offer.nfts[0].duration as number)+1]);

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      await expect(rp.connect(lender).endRental(token, tokenId))
        .to.emit(rp, 'RentalEnded').withArgs(lender.address, tenant.address, token, tokenId)
        .to.emit(borrowedNFT, 'Transfer').withArgs(tenant.address, ZERO_ADDR, tokenId)
        .to.emit(lentNFT, 'Transfer').withArgs(lender.address, ZERO_ADDR, tokenId)
        .to.emit(erc721, 'Transfer').withArgs(rp.address, lender.address, tokenId);
    });

    it("should end rental with sublet", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await rp.connect(tenant).sublet(offer.nfts[0].token, offer.nfts[0].tokenId, subtenant1.address, 20_00)

      await network.provider.send("evm_increaseTime", [(offer.nfts[0].duration as number)+1]);

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      await expect(rp.connect(lender).endRental(token, tokenId))
        .to.emit(rp, 'RentalEnded').withArgs(lender.address, tenant.address, token, tokenId)
        .to.emit(borrowedNFT, 'Transfer').withArgs(subtenant1.address, tenant.address, tokenId)
        .to.emit(subLentNFT, 'Transfer').withArgs(tenant.address, ZERO_ADDR, tokenId)
        .to.emit(borrowedNFT, 'Transfer').withArgs(tenant.address, ZERO_ADDR, tokenId)
        .to.emit(lentNFT, 'Transfer').withArgs(lender.address, ZERO_ADDR, tokenId)
        .to.emit(erc721, 'Transfer').withArgs(rp.address, lender.address, tokenId);
    });

    it("should end a rental prematurely", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await expect(txAcceptOffer).to.emit(rp, 'RentalStarted');

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      // lender ask to end the rental prematurely
      await expect(rp.connect(lender).endRentalPrematurely(token, tokenId))
        .to.emit(rp, 'RequestToEndRentalPrematurely').withArgs(lender.address, token, tokenId);

      // but can't end it unilateraly
      await expect(rp.connect(lender).endRentalPrematurely(token, tokenId))
        .to.be.revertedWith("Forbidden");

      // tenant accepts to end the rental prematurely
      await expect(rp.connect(tenant).endRentalPrematurely(token, tokenId))
        .to.emit(rp, 'RentalEnded');
    });

    it("should fail to to end rental prematurely by reusing past agreement", async () => {
      // mint NFT to lender
      await erc721.mint(lender.address, 123);
      await erc721.connect(lender).setApprovalForAll(rp.address, true);

      let offer = await createOffer(lender, erc721);
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      // lender ask to end the rental prematurely but tenant doesn't care
      rp.connect(lender).endRentalPrematurely(token, tokenId);

      // rental ends "naturally"
      await network.provider.send("evm_increaseTime", [(offer.nfts[0].duration as number)+1]);
      await rp.connect(lender).endRental(offer.nfts[0].token, offer.nfts[0].tokenId);

      // create another offer for the same NFTs
      offer = await createOffer(lender, erc721);
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(anotherTenant).rent(offer, SignatureType.PRE_SIGNED, "0x");

      // ensure anotherTenant can't reuse past lender agreement
      await expect(rp.connect(anotherTenant).endRentalPrematurely(token, tokenId))
        .to.emit(rp, 'RequestToEndRentalPrematurely');
    });

    it("should fail to end rental prematurely by reusing agreement from previous LentNFT owner", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await expect(txAcceptOffer).to.emit(rp, 'RentalStarted');

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      // lender ask to end the rental prematurely
      await rp.connect(lender).endRentalPrematurely(token, tokenId);

      // lender transfer his LentNFT to anotherLender
      await lentNFT.connect(lender).transferFrom(lender.address, anotherLender.address, tokenId);

      // tenant asks to end the rental prematurely without anotherLender approval
      await expect(rp.connect(tenant).endRentalPrematurely(token, tokenId))
        .to.not.emit(rp, 'RentalEnded');

      // now anotherTenant can end the rental prematurely
      await expect(rp.connect(anotherLender).endRentalPrematurely(token, tokenId))
        .to.emit(rp, 'RentalEnded');
    });

    it("should fail to end rental prematurely when sublet", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      const txAcceptOffer = rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await expect(txAcceptOffer).to.emit(rp, 'RentalStarted');

      const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;

      // tenant sublet to subTenant1
      await rp.connect(tenant).sublet(offer.nfts[0].token, offer.nfts[0].tokenId, subtenant1.address, 20_00);

      // subtenant1 ask to end the rental prematurely
      await expect(rp.connect(subtenant1).endRentalPrematurely(token, tokenId))
        .to.be.revertedWith("Sublet not ended");
    });

    it("should fail if rental offer has expired", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`, 0, 42);
      await rp.connect(lender).preSignRentalOffer(offer);

      await expect(rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x"))
        .to.be.revertedWith("Offer deadline");
    });

    it("should fail if rental offer already filled", async () => {
      const domain = await getDomain(rp)
      const types = await getTypes()
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      const signature = await lender._signTypedData(domain, types as any, offer)
      await rp.connect(tenant).rent(offer, SignatureType.EIP_712, signature);
      await expect(rp.connect(tenant).rent(offer, SignatureType.EIP_712, signature)).to.be.revertedWith("cancelled or filled offer");
    });

    it("should fail if rental offer has been cancelled", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(lender).cancelRentalOffer(offer.nonce);
      await expect(rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x")).to.be.revertedWith("cancelled or filled offer");
    });
  });

	describe("Rewards", () => {
		it("should properly distribute rewards", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await rp.connect(tenant).sublet(offer.nfts[0].token, offer.nfts[0].tokenId, subtenant1.address, 20_00);

      // mint some fake rewards to distribute
      const rewardsAmount = 1_000_000;
      await rewardsToken.mint(admin.address, 2 * rewardsAmount);
      // send them to the BorrowedNFT contract
      rewardsToken.transfer(borrowedNFT.address, 2 * rewardsAmount);
      // distribute first borrowed NFT rewards (including sublet) according to fees table
      await expect(borrowedNFT.onERC20Received(offer.nfts[0].tokenId, rewardsToken.address, rewardsAmount))
				.to.emit(borrowedNFT, 'RewardsDistributed').withArgs(offer.nfts[0].tokenId, lender.address, rewardsToken.address, 300_000)
				.to.emit(borrowedNFT, 'RewardsDistributed').withArgs(offer.nfts[0].tokenId, tenant.address, rewardsToken.address, 140_000)
				.to.emit(borrowedNFT, 'RewardsDistributed').withArgs(offer.nfts[0].tokenId, subtenant1.address, rewardsToken.address, 560_000)
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, lender.address, 300_000) // lender: 30% of 1M
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, tenant.address, 140_000) // tenant: 20% of 700k
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, subtenant1.address, 560_000);
      // distribute second borrowed NFT rewards according to fees table
      await expect(borrowedNFT.onERC20Received(offer.nfts[1].tokenId, rewardsToken.address, rewardsAmount))
				.to.emit(borrowedNFT, 'RewardsDistributed').withArgs(offer.nfts[1].tokenId, lender.address, rewardsToken.address, 100_000)
				.to.emit(borrowedNFT, 'RewardsDistributed').withArgs(offer.nfts[1].tokenId, tenant.address, rewardsToken.address, 900_000)
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, lender.address, 100_000) // lender: 10% of 1M
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, tenant.address, 900_000);
    });

		it("should fail if contract hasn't received enough rewards to distribute", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await rp.connect(tenant).sublet(offer.nfts[0].token, offer.nfts[0].tokenId, subtenant1.address, 20_00);

      // mint some fake rewards to distribute
      const rewardsAmount = 1_000_000;
      await rewardsToken.mint(admin.address, rewardsAmount);
      // send them to the BorrowedNFT contract
      rewardsToken.transfer(borrowedNFT.address, rewardsAmount);
      // try to distribute 2 * rewards amount
      await expect(borrowedNFT.onERC20Received(offer.nfts[0].tokenId, rewardsToken.address, 2 * rewardsAmount))
				.to.be.revertedWith("Didn't receive enough ERC20");
    });

		it("should work with 0 reward to distribute", async () => {
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
      await rp.connect(tenant).sublet(offer.nfts[0].token, offer.nfts[0].tokenId, subtenant1.address, 20_00);

      // mint some fake rewards to distribute
      const rewardsAmount = 0;
      // distribute first borrowed NFT rewards (including sublet) according to fees table
      await expect(borrowedNFT.onERC20Received(offer.nfts[0].tokenId, rewardsToken.address, rewardsAmount))
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, lender.address, 0)
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, tenant.address, 0)
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, subtenant1.address, 0);
      // distribute second borrowed NFT rewards according to fees table
      await expect(borrowedNFT.onERC20Received(offer.nfts[1].tokenId, rewardsToken.address, rewardsAmount))
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, lender.address, 0)
        .to.emit(rewardsToken, 'Transfer').withArgs(borrowedNFT.address, tenant.address, 0);
    });
	});

  describe("Rental NFTs", () => {
    it("checks BorrowedNFT metadata", async () => {
      await erc721.mint(admin.address, 123);
      expect(await borrowedNFT.name()).to.equal('bERC721Test');
      expect(await borrowedNFT.symbol()).to.equal('bMNFT');
      expect(await borrowedNFT.tokenURI(123)).to.equal('https://ipfs.io/fake-token/123');
    });

    it("checks LentNFT metadata", async () => {
      await erc721.mint(admin.address, 123);
      expect(await lentNFT.name()).to.equal('lERC721Test');
      expect(await lentNFT.symbol()).to.equal('lMNFT');
      expect(await lentNFT.tokenURI(123)).to.equal('data:application/json;base64,eyJuYW1lIjoiTGVudCBNTkZUIDEyMyIsImRlc2NyaXB0aW9uIjoiTGVudCBNTkZUIGZyb20gQ29tZXRoIFJlbnRhbCIsImFuaW1hdGlvbl91cmwiOiJkYXRhOmltYWdlL3N2Zyt4bWw7YmFzZTY0LFBEOTRiV3dnZG1WeWMybHZiajBpTVM0d0lpQmxibU52WkdsdVp6MGlWVlJHTFRnaVB6NDhjM1puSUhkcFpIUm9QU0l4TURBbElpQm9aV2xuYUhROUlqRXdNQ1VpSUhacFpYZENiM2c5SWpBZ01DQTRNaklnTVRBNU1pSWdlRzFzYm5NOUltaDBkSEE2THk5M2QzY3Vkek11YjNKbkx6SXdNREF2YzNabklpQjRiV3h1Y3pwNGJHbHVhejBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TVRrNU9TOTRiR2x1YXlJK1BHbHRZV2RsSUhoc2FXNXJPbWh5WldZOUltaDBkSEJ6T2k4dmFYQm1jeTVwYnk4eE1qTXVjRzVuSWlCNFBTSXdJaUI1UFNJd0lpQjNhV1IwYUQwaU9ESXlJaUJvWldsbmFIUTlJakV3T1RJaUlDOCtJanhuUGp4d2IyeDVaMjl1SUhCdmFXNTBjejBpTlRBd0xERXpJRFV3TUN3MU55QTFOVEFzTlRjaUlITjBlV3hsUFNKbWFXeHNPaUFqTTBRMk1FTkZPeUJtYVd4MFpYSTZJR0p5YVdkb2RHNWxjM01vTUM0MUtUc2lMejQ4Y0c5c2VXZHZiaUJ3YjJsdWRITTlJamMzTXl3eU9EQWdOek15TERJNE1DQTNNeklzTWpNMklpQnpkSGxzWlQwaVptbHNiRG9nSXpORU5qQkRSVHNnWm1sc2RHVnlPaUJpY21sbmFIUnVaWE56S0RBdU5TazdJaTgrUEhCdmJIbG5iMjRnY0c5cGJuUnpQU0kyTURBc01UTWdOemN6TERFNE1DQTNOek1zTWpnd0lEVXdNQ3d4TXlJZ2MzUjViR1U5SW1acGJHdzZJQ016UkRZd1EwVTdJaTgrUEhSbGVIUWdlRDBpTUNJZ2VUMGlNQ0lnWkc5dGFXNWhiblF0WW1GelpXeHBibVU5SW0xcFpHUnNaU0lnZEdWNGRDMWhibU5vYjNJOUltMXBaR1JzWlNJZ2MzUjViR1U5SW1acGJHdzZJSGRvYVhSbE95Qm1iMjUwTFdaaGJXbHNlVG9nUVhKcFlXdzdJR1p2Ym5RdGMybDZaVG9nTWpod2VEc2dabTl1ZEMxM1pXbG5hSFE2SUdKdmJHUTdJSFJ5WVc1elptOXliVG9nZEhKaGJuTnNZWFJsS0RZMk1IQjRMREV5TlhCNEtTQnliM1JoZEdVb05EVmtaV2NwT3lJK1RHVnVkRHd2ZEdWNGRENDhMMmMrUEM5emRtYysifQ==');
    });

    it("checks SubLentNFT metadata", async () => {
      await erc721.mint(admin.address, 123);
      expect(await subLentNFT.name()).to.equal('slERC721Test');
      expect(await subLentNFT.symbol()).to.equal('slMNFT');
      expect(await subLentNFT.tokenURI(1000036)).to.equal('data:application/json;base64,eyJuYW1lIjoiU3ViTGVudCBNTkZUIDEwMDAwMzYiLCJkZXNjcmlwdGlvbiI6IlN1YkxlbnQgTU5GVCBmcm9tIENvbWV0aCBSZW50YWwiLCJhbmltYXRpb25fdXJsIjoiZGF0YTppbWFnZS9zdmcreG1sO2Jhc2U2NCxQRDk0Yld3Z2RtVnljMmx2YmowaU1TNHdJaUJsYm1OdlpHbHVaejBpVlZSR0xUZ2lQejQ4YzNabklIZHBaSFJvUFNJeE1EQWxJaUJvWldsbmFIUTlJakV3TUNVaUlIWnBaWGRDYjNnOUlqQWdNQ0E0TWpJZ01UQTVNaUlnZUcxc2JuTTlJbWgwZEhBNkx5OTNkM2N1ZHpNdWIzSm5Mekl3TURBdmMzWm5JaUI0Yld4dWN6cDRiR2x1YXowaWFIUjBjRG92TDNkM2R5NTNNeTV2Y21jdk1UazVPUzk0YkdsdWF5SStQR2x0WVdkbElIaHNhVzVyT21oeVpXWTlJbWgwZEhCek9pOHZhWEJtY3k1cGJ5OHhNREF3TURNMkxuQnVaeUlnZUQwaU1DSWdlVDBpTUNJZ2QybGtkR2c5SWpneU1pSWdhR1ZwWjJoMFBTSXhNRGt5SWlBdlBpSThaejQ4Y0c5c2VXZHZiaUJ3YjJsdWRITTlJalV3TUN3eE15QTFNREFzTlRjZ05UVXdMRFUzSWlCemRIbHNaVDBpWm1sc2JEb2dJek5FTmpCRFJUc2dabWxzZEdWeU9pQmljbWxuYUhSdVpYTnpLREF1TlNrN0lpOCtQSEJ2YkhsbmIyNGdjRzlwYm5SelBTSTNOek1zTWpnd0lEY3pNaXd5T0RBZ056TXlMREl6TmlJZ2MzUjViR1U5SW1acGJHdzZJQ016UkRZd1EwVTdJR1pwYkhSbGNqb2dZbkpwWjJoMGJtVnpjeWd3TGpVcE95SXZQanh3YjJ4NVoyOXVJSEJ2YVc1MGN6MGlOakF3TERFeklEYzNNeXd4T0RBZ056Y3pMREk0TUNBMU1EQXNNVE1pSUhOMGVXeGxQU0ptYVd4c09pQWpNMFEyTUVORk95SXZQangwWlhoMElIZzlJakFpSUhrOUlqQWlJR1J2YldsdVlXNTBMV0poYzJWc2FXNWxQU0p0YVdSa2JHVWlJSFJsZUhRdFlXNWphRzl5UFNKdGFXUmtiR1VpSUhOMGVXeGxQU0ptYVd4c09pQjNhR2wwWlRzZ1ptOXVkQzFtWVcxcGJIazZJRUZ5YVdGc095Qm1iMjUwTFhOcGVtVTZJREk0Y0hnN0lHWnZiblF0ZDJWcFoyaDBPaUJpYjJ4a095QjBjbUZ1YzJadmNtMDZJSFJ5WVc1emJHRjBaU2cyTmpCd2VDd3hNalZ3ZUNrZ2NtOTBZWFJsS0RRMVpHVm5LVHNpUGxOMVlreGxiblE4TDNSbGVIUStQQzluUGp3dmMzWm5QZz09In0=');
    });
  });

	describe("Admin Features", () => {
    it("checks pausability", async () => {
			await rp.grantRole(await rp.PAUSER_ROLE(), admin.address);

			// create a rental and
      const offer = await createBundleOffer(lender, ZERO_ADDR, erc721, rp, `0x${randomBytes(32).toString('hex')}`)
			const token = offer.nfts[0].token;
      const tokenId = offer.nfts[0].tokenId;
      await rp.connect(lender).preSignRentalOffer(offer);
      await rp.connect(tenant).rent(offer, SignatureType.PRE_SIGNED, "0x");
			await network.provider.send("evm_increaseTime", [(offer.nfts[0].duration as number)+1]);

			// ensure only admin can pause
			await expect(rp.connect(anotherLender).pause()).to.be.reverted;
			// pause rental protocol
			await rp.pause();
			// try to transfer lender LentNFT to someone else
			await expect(lentNFT.connect(lender).transferFrom(lender.address, anotherLender.address, tokenId))
				.to.be.revertedWith("Rental paused");
			// try to transfer tenant BorrowedNFT to someone else
			await expect(borrowedNFT.connect(tenant).transferFrom(tenant.address, anotherTenant.address, tokenId))
				.to.be.revertedWith("Rental paused");
			// try to end rental
			await expect(rp.connect(lender).endRental(token, tokenId))
				.to.be.revertedWith("Pausable: paused");

			// ensure only admin can unpause
			await expect(rp.connect(anotherLender).unpause()).to.be.reverted;
			// unpause rental protocol
			await rp.unpause();

			// end rental
      await rp.connect(lender).endRental(token, tokenId);
    });
	});

  async function createOffer(lender:any, erc721:any) {
    const deadline = (await ethers.provider.getBlock('latest')).timestamp + 7 * 24 * 3600;
    const offer: IRentalProtocol.RentalOfferStruct = {
      maker: lender.address,
      taker: ZERO_ADDR,
      nfts: [{ token: erc721.address, tokenId: 123, duration: 7 * 24 * 3600, basisPoints: 3000 }],
      feeToken: feesToken.address,
      feeAmount: 0, // no upfront MUST cost
      nonce: `0x${randomBytes(32).toString('hex')}`,
      deadline,
    };
    return offer
  };

  async function createBundleOffer(lender:any, taker:string, erc721:any, rp:any, nonce:any, cost: BigNumberish = 0, deadline = 0) {
    const nfts: IRentalProtocol.NFTStruct[] = [
      { token: erc721.address, tokenId: 123, duration: 7 * 24 * 3600, basisPoints: 30_00 },
      { token: erc721.address, tokenId: 234, duration: 5 * 24 * 3600, basisPoints: 10_00 },
    ];

    // mint some ERC721 for rental offer
    await erc721.mint(lender.address, nfts[0].tokenId);
    await erc721.mint(lender.address, nfts[1].tokenId);
    // approve rental protocol contract to spend the NFTs
    await erc721.connect(lender).setApprovalForAll(rp.address, true);
    const deadlineInSevenDays = (await ethers.provider.getBlock('latest')).timestamp + 7 * 24 * 3600;
    const offer: IRentalProtocol.RentalOfferStruct = {
      maker: lender.address,
      taker,
      nfts,
      feeToken: feesToken.address,
      feeAmount: cost,
      nonce: nonce,
      deadline: deadline > 0 ? deadline : deadlineInSevenDays,
    };

    return offer
  };

  async function getDomain(rp: RentalProtocol) {
    const { chainId } = await ethers.provider.getNetwork();
    return {
      name: await rp.SIGNING_DOMAIN(),
      version: await rp.SIGNATURE_VERSION(),
      chainId,
      verifyingContract: rp.address
    };
  };

  async function getTypes() {
    return {
      RentalOffer: [
        { name: 'maker', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'nfts', type: 'NFT[]' },
        { name: 'feeToken', type: 'address' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ],
      NFT: [
        { name: 'token', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'duration', type: 'uint64' },
        { name: 'basisPoints', type: 'uint16' }
      ]
    };
  };

});
