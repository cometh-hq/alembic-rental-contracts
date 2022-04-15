## Init

```
yarn install
```

## Test

```
npx hardhat test
```

## Deploy

To execute all deploy files.

```
npx hardhat --network mumbai deploy
```

To execute only deploy files with some tags

```
npx hardhat --network mumbai deploy --tags TagName
```

## Flatten

```
npx hardhat  flatten ./contracts/Contract.sol > ContractFlattened.sol
```

## Etherscan verify

```
npx hardhat verify --network rinkeby 0x9044DfBd7c4ce5e3932Bf0366b3f1F2488BD89fD
```

## Doc

[documentation](doc/README.md)

