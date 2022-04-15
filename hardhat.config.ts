import "dotenv/config";
import { HardhatUserConfig, task, types } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import {
  hashBytecodeWithoutMetadata,
  Manifest,
} from "@openzeppelin/upgrades-core";

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address);
  }
});

task("rental:deploy", "Deploy Rental Protocol")
	.addParam("feesCollector", "Address of the fees collector", undefined, types.string, false)
	.addParam("feeBasisPoints", "Basis points of the protocol fee", 5_00, types.int)
	.setAction(async (args, hre) => {
		const accounts = await hre.ethers.getSigners();
		console.info(`Deploying rental protocol with owner "${accounts[0].address}"`);

		// deploy upgradeable contract
		const RentalProtocol = await hre.ethers.getContractFactory("RentalProtocol");
		const rp = await hre.upgrades.deployProxy(RentalProtocol, [args.feesCollector, args.feeBasisPoints]);
		await rp.deployed();
		console.log(`Rental Protocol proxy deployed at: "${rp.address}"`);

		// peer into OpenZeppelin manifest to extract the implementation address
		const ozUpgradesManifestClient = await Manifest.forNetwork(hre.network.provider);
		const manifest = await ozUpgradesManifestClient.read();
		const bytecodeHash = hashBytecodeWithoutMetadata(RentalProtocol.bytecode);
		const implementationContract = manifest.impls[bytecodeHash];

		// verify implementation contract
		if (implementationContract) {
			console.log(`Rental Protocol impl deployed at: "${implementationContract.address}"`);
			await hre.run("verify:verify", {
				address: implementationContract.address
			});
		}
	});

task("rental:link-nfts", "Allow new NFTs to lend (spaceship, cards, ...)")
	.addParam("rental", "Address of the rental protocol", '', types.string)
	.addParam("nft", "Address of the NFT contract allowed for rents", '', types.string)
	.setAction(async (args, hre) => {
		const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
		const accounts = await hre.ethers.getSigners();
		const rp = await hre.ethers.getContractAt("RentalProtocol", args.rental);

		// check if the NFT contract is already linked
		const linked = await rp.originalToLentNFT(args.nft) != ZERO_ADDRESS;

		if (!linked) {
			console.info(`Deploying LentNFT, SubLentNFT and BorrowedNFTs with owner "${accounts[0].address}"`);

			// deploy upgradeable contracts
			const LentNFT = await hre.ethers.getContractFactory("LentNFT");
			const SubLentNFT = await hre.ethers.getContractFactory("SubLentNFT");
			const BorrowedNFT = await hre.ethers.getContractFactory("BorrowedNFT");
			const ozUpgradesManifestClient = await Manifest.forNetwork(hre.network.provider);
			const manifest = await ozUpgradesManifestClient.read();
			const lentNFT = await hre.upgrades.deployProxy(LentNFT, [rp.address, args.nft]);
			await lentNFT.deployed();
			const subLentNFT = await hre.upgrades.deployProxy(SubLentNFT, [rp.address, args.nft]);
			await subLentNFT.deployed();
			const borrowedNFT = await hre.upgrades.deployProxy(BorrowedNFT, [rp.address, args.nft]);
			await borrowedNFT.deployed();
			console.log("NFTs (LentNFT, SubLentNFT, BorrowedNFT) deployed at:", lentNFT.address, subLentNFT.address, borrowedNFT.address);

			// link the deployed NFTs to the rental protocol
			await rp.associateOriginalToLentAndBorrowedNFT(
				args.nft,
				lentNFT.address,
				borrowedNFT.address,
				subLentNFT.address
			);

			// verify implementation contracts
			await Promise.all([LentNFT, SubLentNFT, BorrowedNFT].map(async (contract) => {
				// peer into OpenZeppelin manifest to extract the implementation address
				const bytecodeHash = hashBytecodeWithoutMetadata(contract.bytecode);
				const implementationContract = manifest.impls[bytecodeHash];
				// verify implementation contract
				if (implementationContract) {
					console.log(`impl deployed at: "${implementationContract.address}"`);
					await hre.run("verify:verify", {
						address: implementationContract.address
					});
				}
			}));
		}
	});

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 5000,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
    },
    matic: {
      url: "https://polygon-mainnet.infura.io/v3/acce0cfb78984d439d6e2ac7e1b82845",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 137,
      gas: "auto",
      // gasPrice: 100000000000,
    },
    mumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 80001,
      // gasPrice: 100_000_000_000,
    },
  },
  typechain: {
		outDir: 'artifacts/typechain',
		target: 'ethers-v5',
	},
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? true : false,
  },
	/*
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
    },
  },
	*/
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
