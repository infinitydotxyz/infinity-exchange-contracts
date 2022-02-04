import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-waffle';

import './tasks/default';

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
    mainnet: {
      url: 'https://eth-mainnet.alchemyapi.io/v2/' + process.env.ALCHEMY_MAINNET_KEY,
      accounts: [process.env.ETH_MAINNET_PRIV_KEY],
      gasPrice: parseUnits('30', 'gwei').toNumber()
    },
    polygonprod: {
      url: 'https://polygon-rpc.com/',
      accounts: [process.env.POLYGON_PROD_PRIV_KEY],
      gasPrice: parseUnits('200', 'gwei').toNumber()
    }
  },
  solidity: {
    compilers: [
      {
        version: '0.4.23',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: '0.8.4',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    ]
  },
  // etherscan: {
  //   apiKey: process.env.ETHERSCAN_API_KEY
  // },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false
  }
} as HardhatUserConfig;
