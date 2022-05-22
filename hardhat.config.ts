import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-waffle';
import 'hardhat-gas-reporter';

import './tasks/deploy';

import { HardhatUserConfig } from 'hardhat/config';
import { parseUnits } from 'ethers/lib/utils';

require('dotenv').config();
require('hardhat-contract-sizer');

export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
      gas: 10000000
    },
    ropsten: {
      url: 'https://eth-ropsten.alchemyapi.io/v2/' + process.env.ALCHEMY_ROPSTEN_KEY,
      accounts: [process.env.ETH_ROPSTEN_PRIV_KEY]
    },
    goerli: {
      url: 'https://eth-goerli.alchemyapi.io/v2/' + process.env.ALCHEMY_GOERLI_KEY,
      accounts: [process.env.ETH_GOERLI_PRIV_KEY]
    },
    mainnet: {
      url: 'https://eth-mainnet.alchemyapi.io/v2/' + process.env.ALCHEMY_MAINNET_KEY,
      accounts: [process.env.ETH_MAINNET_PRIV_KEY, process.env.ETH_MAINNET_PRIV_KEY_2],
      gasPrice: parseUnits('30', 'gwei').toNumber()
    },
    polygonprod: {
      url: 'https://polygon-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_POLYGON_MAIN_KEY,
      accounts: [process.env.POLYGON_PROD_PRIV_KEY, process.env.POLYGON_PROD_PRIV_KEY_2],
      gasPrice: parseUnits('80', 'gwei').toNumber()
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.8.14',
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 99999999
            // runs: 1 // todo: set to 99999999
          }
        }
      }
    ]
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  // etherscan: {
  //   apiKey: process.env.POLYGONSCAN_API_KEY
  // }
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false
  }
} as HardhatUserConfig;
