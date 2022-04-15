import "dotenv/config";
import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";

import "hardhat-deploy";

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000000,
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
      accounts: process.env.PRIVATE_KEY
        ? { mnemonic: process.env.PRIVATE_KEY }
        : [],
      chainId: 137,
      gas: "auto",
      gasPrice: 100000000000,
      saveDeployments: true,
    },
    mumbai: {
      url: "https://polygon-mumbai.infura.io/v3/5dcbe15e820c4bb18cfa622961802a86",
      //accounts: { mnemonic: process.env.PRIVATE_KEY || "0xfe3a710288c6608caa0676af735178fc5564d1ccf0ecf9f60cf0f16f680b8983" },
      accounts:
        process.env.PRIVATE_KEY !== undefined
          ? { mnemonic: process.env.PRIVATE_KEY }
          : [
              "8e76cfbec18456988780e4ab38a1b5bd5aa3ee6a1dbd784cab64007a1b979d6b",
            ],
      chainId: 80001,
      gasPrice: 100_000_000_000,
      saveDeployments: true,
    },
  },
  typechain: {
		outDir: 'artifacts/typechain',
		target: 'ethers-v5',
	},
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? true : false,
  },
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

export default config;
