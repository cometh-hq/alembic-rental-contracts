import { run, ethers, upgrades, network } from "hardhat";
import {
  hashBytecodeWithoutMetadata,
  Manifest,
} from "@openzeppelin/upgrades-core";
import { RentalProtocol } from "../artifacts/typechain";

async function main() {
  await run("compile");

  const accounts = await ethers.getSigners();
	const gnosisSafe = '0xD813154aCA43f41cf6d862dAc6c977f0dFbb2ada'; // Polygon Safe
	const feesCollector = '0x9F2A409848Fb9b7BD058b24A23e8dBF1E166A109';
	const spaceships = "0x85BC2E8Aaad5dBc347db49Ea45D95486279eD918";

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
