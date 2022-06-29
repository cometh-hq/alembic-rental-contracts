import { run, ethers, network } from "hardhat";
import {
  hashBytecodeWithoutMetadata,
  Manifest,
} from "@openzeppelin/upgrades-core";

async function main() {
	// peer into OpenZeppelin manifest to extract the implementation address
	const ozUpgradesManifestClient = await Manifest.forNetwork(network.provider);
	const manifest = await ozUpgradesManifestClient.read();

	// verify RentalProtocol
	try {
		const RentalProtocol = await ethers.getContractFactory("RentalProtocol");
		const bytecodeHash = hashBytecodeWithoutMetadata(RentalProtocol.bytecode);
		const implementationContract = manifest.impls[bytecodeHash];
		await run("verify:verify", { address: implementationContract!.address });
	} catch (err: unknown) {}

	// verify rental NFTs contracts
	try {
		const LentNFT = await ethers.getContractFactory("LentNFT");
		const bytecodeHash = hashBytecodeWithoutMetadata(LentNFT.bytecode);
		const implementationContract = manifest.impls[bytecodeHash];
		await run("verify:verify", { address: implementationContract!.address });
	} catch (err: unknown) {}

	try {
		const SubLentNFT = await ethers.getContractFactory("SubLentNFT");
		const bytecodeHash = hashBytecodeWithoutMetadata(SubLentNFT.bytecode);
		const implementationContract = manifest.impls[bytecodeHash];
		await run("verify:verify", { address: implementationContract!.address });
	} catch (err: unknown) {}

	try {
		const BorrowedNFT = await ethers.getContractFactory("BorrowedNFT");
		const bytecodeHash = hashBytecodeWithoutMetadata(BorrowedNFT.bytecode);
		const implementationContract = manifest.impls[bytecodeHash];
		await run("verify:verify", { address: implementationContract!.address });
	} catch (err: unknown) {}
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
