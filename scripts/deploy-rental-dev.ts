import { run, ethers, upgrades, network } from "hardhat";
import {
  hashBytecodeWithoutMetadata,
  Manifest,
} from "@openzeppelin/upgrades-core";
import { RentalProtocol } from "../artifacts/typechain";

async function main() {
  await run("compile");

  const accounts = await ethers.getSigners();
	const gnosisSafe = '0x84AC85FfeD44ff50858AE9721E1DDe69500D57f2'; // Polygon Safe
	const feesCollector = '0xf845b2501A69eF480aC577b99e96796c2B6AE88E';
	const spaceships = "0x78DE8691c97399346DB8685bd3c2D55c6d033c3C";

	console.info(`Deploying rental protocol with owner "${accounts[0].address}"`);

	// deploy upgradeable contract
	const RentalProtocol = await ethers.getContractFactory("RentalProtocol");
	const rp = await upgrades.deployProxy(RentalProtocol, [feesCollector, 5_00]) as RentalProtocol; // 5% protocol fees
	await rp.deployed();
	console.log(`Rental Protocol proxy deployed at: "${rp.address}"`);

	// link spaceships to rental NFTs
	await associateSpaceships(rp, spaceships);

	const ADMIN_ROLE = await rp.DEFAULT_ADMIN_ROLE();
	const FEES_MANAGER_ROLE = await rp.FEES_MANAGER_ROLE();
	const TOKENS_MANAGER_ROLE = await rp.TOKENS_MANAGER_ROLE();

	// grant ADMIN role to Safe wallet
	await rp.grantRole(ADMIN_ROLE, gnosisSafe);

	// revoke roles of initial acccount used to deploy
	await rp.revokeRole(FEES_MANAGER_ROLE, accounts[0].address);
	await rp.revokeRole(TOKENS_MANAGER_ROLE, accounts[0].address);
	await rp.revokeRole(ADMIN_ROLE, accounts[0].address);

	// transfer ownership to Safe
  console.log("\nTransferring ownership of ProxyAdmin...");
  await upgrades.admin.transferProxyAdminOwnership(gnosisSafe);
  console.log("Transferred ownership of ProxyAdmin to:", gnosisSafe);
}

async function associateSpaceships(rp: RentalProtocol, spaceships: string) {
	const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

	// check if the NFT contract is already linked
	const linked = await rp.originalToLentNFT(spaceships) != ZERO_ADDRESS;

	if (!linked) {
		console.info(`\nDeploying LentNFT, SubLentNFT and BorrowedNFTs for spaceships`);

		// deploy upgradeable contracts
		const LentNFT = await ethers.getContractFactory("LentNFT");
		const SubLentNFT = await ethers.getContractFactory("SubLentNFT");
		const BorrowedNFT = await ethers.getContractFactory("BorrowedNFT");
		const ozUpgradesManifestClient = await Manifest.forNetwork(network.provider);
		const manifest = await ozUpgradesManifestClient.read();
		const lentNFT = await upgrades.deployProxy(LentNFT, [rp.address, spaceships, "https://images.service.cometh.io/", ".png"]);
		await lentNFT.deployed();
		const subLentNFT = await upgrades.deployProxy(SubLentNFT, [rp.address, spaceships, "https://images.service.cometh.io/", ".png"]);
		await subLentNFT.deployed();
		const borrowedNFT = await upgrades.deployProxy(BorrowedNFT, [rp.address, spaceships]);
		await borrowedNFT.deployed();
		console.log("NFTs (LentNFT, SubLentNFT, BorrowedNFT) deployed at:", lentNFT.address, subLentNFT.address, borrowedNFT.address);

		// link the deployed NFTs to the rental protocol
		await rp.associateOriginalToLentAndBorrowedNFT(
			spaceships,
			lentNFT.address,
			borrowedNFT.address,
			subLentNFT.address
		);
	}
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
