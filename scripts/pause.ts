import { RLP } from "ethers/lib/utils";
import { ethers } from "hardhat";
const { default: EthersAdapter } = require("@gnosis.pm/safe-ethers-lib");
const { default: Safe } = require("@gnosis.pm/safe-core-sdk");
const {
  SafeEthersSigner,
  SafeService,
} = require("@gnosis.pm/safe-ethers-adapters");
const { TransactionType } = require("ethers-multisend");
import { RentalProtocol } from "../artifacts/typechain";

const safeAddress = "0x84AC85FfeD44ff50858AE9721E1DDe69500D57f2";
const rentalProxyAddress = "0x66e4B205E40ac9bF8a422Cd811CFA8bAB4dedFAA";

async function main() {
	const safe = await getSafe(safeAddress, ethers); // safe for dev env

	const rp = await ethers.getContractAt("RentalProtocol", rentalProxyAddress) as RentalProtocol;
	const PAUSER_ROLE = await rp.PAUSER_ROLE();

	const tx = await safe.createTransaction([
		{
			type: TransactionType.raw,
			to: rentalProxyAddress,
			value: "0",
			data: rp.interface.encodeFunctionData("grantRole", [
				PAUSER_ROLE,
				safeAddress,
			]),
		},
		{
			type: TransactionType.raw,
			to: rentalProxyAddress,
			value: "0",
			data: rp.interface.encodeFunctionData("pause"),
		},
		{
			type: TransactionType.raw,
			to: rentalProxyAddress,
			value: "0",
			data: rp.interface.encodeFunctionData("revokeRole", [
				PAUSER_ROLE,
				safeAddress,
			]),
		}
	]);
  const options = {};
  const response = await safe.executeTransaction(tx, options);
  console.log(response.transactionResponse?.hash);
  await response.transactionResponse?.wait();
}

async function getSafe(safeAddress: string, ethers: any) {
  const { chainId } = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const ethersAdapter = new EthersAdapter({ ethers, signer: deployer });

  if (!safeAddress) {
    return null;
  }

  const safe = await Safe.create({
    ethAdapter: ethersAdapter,
    safeAddress,
    isL1SafeMasterCopy: true,
  });

  return safe;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
