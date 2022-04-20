const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { deployContract } = require('../tasks/utils');
const {
  prepareOBOrder,
  signOBOrder,
  getCurrentSignedOrderPrice,
  approveERC721,
  approveERC20,
  signFormattedOrder
} = require('../helpers/orders');
const { nowSeconds, trimLowerCase } = require('@infinityxyz/lib/utils');
const { erc721Abi } = require('../abi/erc721');
const { erc20Abi } = require('../abi/erc20');
const { JsonRpcSigner } = require('@ethersproject/providers');

describe('Exchange_Rewards_Maker_Sell_Taker_Buy', function () {
  let signers,
    signer1,
    signer2,
    signer3,
    token,
    infinityExchange,
    mock721Contract1,
    mock721Contract2,
    mock721Contract3,
    currencyRegistry,
    complicationRegistry,
    obComplication,
    infinityTreasury,
    infinityStaker,
    infinityTradingRewards,
    infinityFeeTreasury,
    infinityCreatorsFeeRegistry,
    mockRoyaltyEngine,
    infinityCreatorsFeeManager;

  const sellOrders = [];

  let signer1Balance = toBN(0);
  let signer2Balance = toBN(0);
  let totalCuratorFees = toBN(0);
  let orderNonce = 0;
  let numTakeOrders = -1;

  const CURATOR_FEE_BPS = 150;
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const MINUTE = 60;
  const HOUR = MINUTE * 60;
  const DAY = HOUR * 24;
  const MONTH = DAY * 30;
  const YEAR = MONTH * 12;
  const UNIT = toBN(1e18);
  const INFLATION = toBN(300_000_000).mul(UNIT); // 40m
  const EPOCH_DURATION = YEAR;
  const CLIFF = toBN(3);
  const CLIFF_PERIOD = CLIFF.mul(YEAR);
  const MAX_EPOCHS = 6;
  const TIMELOCK = 30 * DAY;
  const INITIAL_SUPPLY = toBN(1_000_000_000).mul(UNIT); // 1b

  const totalNFTSupply = 100;
  const numNFTsToTransfer = 50;
  const numNFTsLeft = totalNFTSupply - numNFTsToTransfer;

  const bronzeBps = 9000;
  const silverBps = 8000;
  const goldBps = 7000;
  const platinumBps = 6000;

  const amountStaked = ethers.utils.parseEther('700');
  const amountStaked2 = ethers.utils.parseEther('5000');

  let rewardRatio = toBN(1);
  let totalRewardEarned = toBN(0);
  let infinityRewardsBalance = toBN(0);

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  before(async () => {
    // signers
    signers = await ethers.getSigners();
    signer1 = signers[0];
    signer2 = signers[1];
    signer3 = signers[2];
    // token
    const tokenArgs = [
      signer1.address,
      INFLATION.toString(),
      EPOCH_DURATION.toString(),
      CLIFF_PERIOD.toString(),
      MAX_EPOCHS.toString(),
      TIMELOCK.toString(),
      INITIAL_SUPPLY.toString()
    ];
    token = await deployContract(
      'InfinityToken',
      await ethers.getContractFactory('InfinityToken'),
      signers[0],
      tokenArgs
    );

    // NFT contracts
    mock721Contract1 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 1',
      'MCKNFT1'
    ]);
    mock721Contract2 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 2',
      'MCKNFT2'
    ]);
    mock721Contract3 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 3',
      'MCKNFT3'
    ]);

    // Currency registry
    currencyRegistry = await deployContract(
      'InfinityCurrencyRegistry',
      await ethers.getContractFactory('InfinityCurrencyRegistry'),
      signer1
    );

    // Complication registry
    complicationRegistry = await deployContract(
      'InfinityComplicationRegistry',
      await ethers.getContractFactory('InfinityComplicationRegistry'),
      signer1
    );

    // Exchange
    infinityExchange = await deployContract(
      'InfinityExchange',
      await ethers.getContractFactory('InfinityExchange'),
      signer1,
      [currencyRegistry.address, complicationRegistry.address, token.address, signer3.address]
    );

    // OB complication
    obComplication = await deployContract(
      'InfinityOrderBookComplication',
      await ethers.getContractFactory('InfinityOrderBookComplication'),
      signer1,
      [0, 1_000_000]
    );

    // Infinity treasury
    infinityTreasury = signer1.address;

    // Infinity Staker
    infinityStaker = await deployContract(
      'InfinityStaker',
      await ethers.getContractFactory('InfinityStaker'),
      signer1,
      [token.address, infinityTreasury]
    );

    // Infinity Trading Rewards
    infinityTradingRewards = await deployContract(
      'InfinityTradingRewards',
      await ethers.getContractFactory('contracts/core/InfinityTradingRewards.sol:InfinityTradingRewards'),
      signer1,
      [infinityExchange.address, infinityStaker.address, token.address]
    );

    // Infinity Creator Fee Registry
    infinityCreatorsFeeRegistry = await deployContract(
      'InfinityCreatorsFeeRegistry',
      await ethers.getContractFactory('InfinityCreatorsFeeRegistry'),
      signer1
    );

    // Infinity Creators Fee Manager
    mockRoyaltyEngine = await deployContract(
      'MockRoyaltyEngine',
      await ethers.getContractFactory('MockRoyaltyEngine'),
      signer1
    );

    // Infinity Creators Fee Manager
    infinityCreatorsFeeManager = await deployContract(
      'InfinityCreatorsFeeManager',
      await ethers.getContractFactory('InfinityCreatorsFeeManager'),
      signer1,
      [mockRoyaltyEngine.address, infinityCreatorsFeeRegistry.address]
    );

    // Infinity Fee Treasury
    infinityFeeTreasury = await deployContract(
      'InfinityFeeTreasury',
      await ethers.getContractFactory('InfinityFeeTreasury'),
      signer1,
      [infinityExchange.address, infinityStaker.address, infinityCreatorsFeeManager.address]
    );

    // add currencies to registry
    await currencyRegistry.addCurrency(token.address);

    // add complications to registry
    await complicationRegistry.addComplication(obComplication.address);

    // set infinity fee treasury on exchange
    await infinityExchange.updateInfinityFeeTreasury(infinityFeeTreasury.address);

    // set infinity rewards on exchange
    await infinityExchange.updateInfinityTradingRewards(infinityTradingRewards.address);

    // set infinity rewards on staker
    await infinityStaker.updateInfinityRewardsContract(infinityTradingRewards.address);

    // set creator fee manager on registry
    await infinityCreatorsFeeRegistry.updateCreatorsFeeManager(infinityCreatorsFeeManager.address);

    // set reward token
    await infinityTradingRewards.addRewardToken(token.address);
    let rewardTokenFundAmount = INITIAL_SUPPLY.div(4);
    infinityRewardsBalance = rewardTokenFundAmount;
    // @ts-ignore
    await approveERC20(signer1.address, token.address, rewardTokenFundAmount, signer1, infinityTradingRewards.address);
    await infinityTradingRewards.fundWithRewardToken(token.address, signer1.address, rewardTokenFundAmount);

    // send assets
    await token.transfer(signer2.address, INITIAL_SUPPLY.div(2).toString());
    signer1Balance = INITIAL_SUPPLY.div(4);
    signer2Balance = INITIAL_SUPPLY.div(2);
    for (let i = 0; i < numNFTsToTransfer; i++) {
      await mock721Contract1.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract2.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract3.transferFrom(signer1.address, signer2.address, i);
    }
  });

  describe('Setup', () => {
    it('Should init properly', async function () {
      expect(await token.name()).to.equal('Infinity');
      expect(await token.symbol()).to.equal('NFT');
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);

      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(4));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(INITIAL_SUPPLY.div(4));

      expect(await mock721Contract1.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract1.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract2.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract2.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract3.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract3.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);
    });
  });

  // ================================================== MAKE SELL ORDERS ==================================================

  // one specific collection, one specific token, min price
  describe('OneCollectionOneTokenSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 0, numTokens: 1 }]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // one specific collection, multiple specific tokens, min aggregate price
  describe('OneCollectionMultipleTokensSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [
            { tokenId: 1, numTokens: 1 },
            { tokenId: 2, numTokens: 1 },
            { tokenId: 3, numTokens: 1 }
          ]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // one specific collection, any one token, min price
  describe('OneCollectionAnyOneTokenSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // one specific collection, any multiple tokens, min aggregate price, max number of tokens
  describe('OneCollectionAnyMultipleTokensSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 4,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // multiple specific collections, multiple specific tokens per collection, min aggregate price
  describe('MultipleCollectionsMultipleTokensSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 11, numTokens: 1 }]
        },
        {
          collection: mock721Contract2.address,
          tokens: [
            { tokenId: 0, numTokens: 1 },
            { tokenId: 1, numTokens: 1 }
          ]
        },
        {
          collection: mock721Contract3.address,
          tokens: [
            { tokenId: 0, numTokens: 1 },
            { tokenId: 1, numTokens: 1 },
            { tokenId: 2, numTokens: 1 }
          ]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // multiple specific collections, any multiple tokens per collection, min aggregate price, max aggregate number of tokens
  describe('MultipleCollectionsAnyTokensSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        },
        {
          collection: mock721Contract2.address,
          tokens: []
        },
        {
          collection: mock721Contract3.address,
          tokens: []
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 5,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // any collection, any one token, min price
  describe('AnyCollectionAnyOneTokenSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // any collection, any multiple tokens, min aggregate price, max aggregate number of tokens
  describe('AnyCollectionAnyMultipleTokensSell', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId;
      const nfts = [];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 12,
        startPrice: ethers.utils.parseEther('5'),
        endPrice: ethers.utils.parseEther('5'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer2,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // ================================================== TAKE SELL ORDERS ===================================================

  describe('Take_OneCollectionOneTokenSell', () => {
    it('Should take valid order with no discount and no trading rewards', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const nfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(0);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(0);
    });
  });

  describe('Stake tokens to bronze level', () => {
    it('Should stake', async function () {
      // approve erc20
      await approveERC20(signer2.address, token.address, amountStaked, signer2, infinityStaker.address);
      await infinityStaker.connect(signer2).stake(signer2.address, amountStaked, 1);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(1);
      signer2Balance = signer2Balance.sub(amountStaked);
    });
  });

  describe('Update rewards map', () => {
    it('Should update', async function () {
      await infinityTradingRewards.updateRewardsMap(token.address, token.address, rewardRatio);
      expect(await infinityTradingRewards.rewardsMap(token.address, token.address)).to.equal(rewardRatio);
    });
  });

  describe('Take_OneCollectionMultipleTokensSell', () => {
    it('Should take valid order with no discount even if staked but rewards earned', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const nfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Update stake level effective bps', () => {
    it('Should update', async function () {
      await infinityFeeTreasury.updateEffectiveFeeBps(0, bronzeBps);
      await infinityFeeTreasury.updateEffectiveFeeBps(1, silverBps);
      await infinityFeeTreasury.updateEffectiveFeeBps(2, goldBps);
      await infinityFeeTreasury.updateEffectiveFeeBps(3, platinumBps);
    });
  });

  describe('Take_OneCollectionAnyOneTokenSell', () => {
    it('Should take valid order with silver discount and rewards earned', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const sellOrderNfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // form matching nfts
      const nfts = [];
      for (const buyOrderNft of sellOrderNfts) {
        const collection = buyOrderNft.collection;
        const nft = {
          collection,
          tokens: [
            {
              tokenId: 4,
              numTokens: 1
            }
          ]
        };
        nfts.push(nft);
      }

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const effectiveBps = (silverBps * CURATOR_FEE_BPS) / 10000;
      const fee = salePrice.mul(effectiveBps).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Stake tokens to silver level', () => {
    it('Should stake', async function () {
      // approve erc20
      await approveERC20(signer2.address, token.address, amountStaked2, signer2, infinityStaker.address);
      await infinityStaker.connect(signer2).stake(signer2.address, amountStaked2, 0);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(2);
      signer2Balance = signer2Balance.sub(amountStaked2);
    });
  });

  describe('Take_OneCollectionAnyMultipleTokensSell', () => {
    it('Should take valid order with no discount and rewards earned', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const sellOrderNfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // form matching nfts
      const nfts = [];
      for (const sellOrderNft of sellOrderNfts) {
        const collection = sellOrderNft.collection;
        const nft = {
          collection,
          tokens: [
            {
              tokenId: 5,
              numTokens: 1
            },
            {
              tokenId: 6,
              numTokens: 1
            },
            {
              tokenId: 7,
              numTokens: 1
            },
            {
              tokenId: 8,
              numTokens: 1
            }
          ]
        };
        nfts.push(nft);
      }

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, false);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Change duration to platinum level', () => {
    it('Should change duration', async function () {
      await infinityStaker.connect(signer2).changeDuration(amountStaked2, 0, 1);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(3);
    });
  });

  describe('Update rewards map', () => {
    it('Should update', async function () {
      rewardRatio = rewardRatio.mul(2);
      await infinityTradingRewards.updateRewardsMap(token.address, token.address, rewardRatio);
      expect(await infinityTradingRewards.rewardsMap(token.address, token.address)).to.equal(rewardRatio);
    });
  });

  describe('Take_MultipleCollectionsMultipleTokensSell', () => {
    it('Should take valid order with platinum discount and updated rewards', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const nfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const effectiveBps = (platinumBps * CURATOR_FEE_BPS) / 10000;
      const fee = salePrice.mul(effectiveBps).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);

      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('RageQuit to bronze level', () => {
    it('Should rage quit', async function () {
      const result = await infinityStaker.getRageQuitAmounts(signer2.address);
      const totalToUser = result[0];
      const penalty = result[1];
      await infinityStaker.connect(signer2).rageQuit();
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(0);
      signer1Balance = signer1Balance.add(penalty);
      signer2Balance = signer2Balance.add(totalToUser);
    });
  });

  describe('Update rewards map', () => {
    it('Should update', async function () {
      rewardRatio = rewardRatio.sub(rewardRatio);
      await infinityTradingRewards.updateRewardsMap(token.address, token.address, rewardRatio);
      expect(await infinityTradingRewards.rewardsMap(token.address, token.address)).to.equal(rewardRatio);
    });
  });

  describe('Take_MultipleCollectionsAnyTokensSell', () => {
    it('Should take valid order with no discount and no rewards', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const sellOrderNfts = sellOrder.nfts;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // form matching nfts
      const nfts = [];
      let i = 0;
      for (const buyOrderNft of sellOrderNfts) {
        ++i;
        const collection = buyOrderNft.collection;
        let nft;
        if (i === 1) {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 20,
                numTokens: 1
              },
              {
                tokenId: 21,
                numTokens: 1
              }
            ]
          };
        } else if (i === 2) {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 10,
                numTokens: 1
              }
            ]
          };
        } else {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 10,
                numTokens: 1
              },
              {
                tokenId: 11,
                numTokens: 1
              }
            ]
          };
        }

        nfts.push(nft);
      }

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Stake tokens to silver level', () => {
    it('Should stake', async function () {
      // approve erc20
      await approveERC20(signer2.address, token.address, amountStaked2, signer2, infinityStaker.address);
      await infinityStaker.connect(signer2).stake(signer2.address, amountStaked2, 0);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(1);
    });
  });

  describe('Unstake tokens to bronze level', () => {
    it('Should unstake', async function () {
      await infinityStaker.connect(signer2).unstake(amountStaked2);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(0);
    });
  });

  describe('Update rewards map', () => {
    it('Should update', async function () {
      rewardRatio = toBN(1);
      await infinityTradingRewards.updateRewardsMap(token.address, token.address, rewardRatio);
      expect(await infinityTradingRewards.rewardsMap(token.address, token.address)).to.equal(rewardRatio);
    });
  });

  describe('Take_AnyCollectionAnyOneTokenSell', () => {
    it('Should take valid order no discount and reward earned', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // form matching nfts
      const nfts = [];
      const collection = mock721Contract3.address;
      const nft = {
        collection,
        tokens: [
          {
            tokenId: 15,
            numTokens: 1
          }
        ]
      };
      nfts.push(nft);

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, false);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Stake tokens to silver level', () => {
    it('Should stake', async function () {
      // approve erc20
      await approveERC20(signer2.address, token.address, amountStaked2, signer2, infinityStaker.address);
      await infinityStaker.connect(signer2).stake(signer2.address, amountStaked2, 0);
      expect(await infinityStaker.getUserStakeLevel(signer2.address)).to.equal(1);
      signer2Balance = signer2Balance.sub(amountStaked2);
    });
  });

  describe('Update stake level effective bps', () => {
    it('Should update', async function () {
      await infinityFeeTreasury.updateEffectiveFeeBps(0, 10000);
      await infinityFeeTreasury.updateEffectiveFeeBps(1, 10000);
      await infinityFeeTreasury.updateEffectiveFeeBps(2, 10000);
      await infinityFeeTreasury.updateEffectiveFeeBps(3, 10000);
    });
  });

  describe('Take_AnyCollectionAnyMultipleTokensSell', () => {
    it('Should take valid order with no discount even if staked and rewards earned', async function () {
      const sellOrder = sellOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = false;

      const constraints = sellOrder.constraints;
      const execParams = sellOrder.execParams;
      const extraParams = sellOrder.extraParams;

      // form matching nfts
      const nfts = [];
      const nft1 = {
        collection: mock721Contract1.address,
        tokens: [
          {
            tokenId: 30,
            numTokens: 1
          },
          {
            tokenId: 31,
            numTokens: 1
          },
          {
            tokenId: 32,
            numTokens: 1
          }
        ]
      };
      const nft2 = {
        collection: mock721Contract2.address,
        tokens: [
          {
            tokenId: 35,
            numTokens: 1
          },
          {
            tokenId: 36,
            numTokens: 1
          },
          {
            tokenId: 37,
            numTokens: 1
          },
          {
            tokenId: 38,
            numTokens: 1
          },
          {
            tokenId: 39,
            numTokens: 1
          }
        ]
      };
      const nft3 = {
        collection: mock721Contract3.address,
        tokens: [
          {
            tokenId: 20,
            numTokens: 1
          },
          {
            tokenId: 21,
            numTokens: 1
          },
          {
            tokenId: 22,
            numTokens: 1
          },
          {
            tokenId: 23,
            numTokens: 1
          }
        ]
      };

      nfts.push(nft1);
      nfts.push(nft2);
      nfts.push(nft3);

      // approve currency
      let salePrice = getCurrentSignedOrderPrice(sellOrder);
      await approveERC20(signer1.address, execParams[1], salePrice, signer1, infinityFeeTreasury.address);

      // sign order
      const buyOrder = {
        isSellOrder,
        signer: signer1.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ''
      };
      buyOrder.sig = await signFormattedOrder(chainId, contractAddress, buyOrder, signer1);

      const isSigValid = await infinityExchange.verifyOrderSig(buyOrder);
      expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      salePrice = getCurrentSignedOrderPrice(buyOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await infinityExchange.connect(signer1).takeOrders([sellOrder], [buyOrder], true, true);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // rewards
      const rewardEarned = salePrice.mul(rewardRatio);
      totalRewardEarned = totalRewardEarned.add(rewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Rescue tokens', () => {
    it('Should rescue', async function () {
      const rescueAmount = ethers.utils.parseEther('1');
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);

      await infinityTradingRewards.rescueTokens(signer1.address, token.address, rescueAmount);

      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance.sub(rescueAmount));
      infinityRewardsBalance = infinityRewardsBalance.sub(rescueAmount);
    });
  });

  describe('Try rescue tokens', () => {
    it('Should not rescue', async function () {
      const rescueAmount = ethers.utils.parseEther('1');

      await expect(
        infinityTradingRewards.connect(signer2).rescueTokens(signer2.address, token.address, rescueAmount)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);
    });
  });

  describe('Claim reward tokens', () => {
    it('Should claim', async function () {
      const claimAmount = toBN(1);
      // console.log('total reward earned', totalRewardEarned);
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);

      await infinityTradingRewards.claimRewards(signer1.address, token.address, claimAmount);
      await infinityTradingRewards.claimRewards(signer2.address, token.address, claimAmount);

      infinityRewardsBalance = infinityRewardsBalance.sub(claimAmount.mul(2));
      totalRewardEarned = totalRewardEarned.sub(claimAmount);
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Try claim reward tokens large amount', () => {
    it('Should not claim', async function () {
      const claimAmount = ethers.utils.parseEther('100000');
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);

      await expect(infinityTradingRewards.claimRewards(signer1.address, token.address, claimAmount)).to.be.revertedWith(
        'Not enough rewards to claim'
      );

      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
    });
  });

  describe('Stake reward tokens', () => {
    it('Should stake', async function () {
      const stakeAmount = toBN(1);
      // console.log('total reward earned', totalRewardEarned);
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);

      // console.log('infinity staker balance before', (await token.balanceOf(infinityStaker.address)).toString());
      // approve erc20
      await approveERC20(signer1.address, token.address, stakeAmount, signer1, infinityStaker.address);

      const userStaked1 = await infinityStaker.getUserTotalStaked(signer1.address);
      const userStaked2 = await infinityStaker.getUserTotalStaked(signer2.address);

      await infinityTradingRewards.connect(signer1).stakeInfinityRewards(stakeAmount, 0);
      // console.log('infinity staker balance after 1', (await token.balanceOf(infinityStaker.address)).toString());
      await infinityTradingRewards.connect(signer2).stakeInfinityRewards(stakeAmount, 2);
      // console.log('infinity staker balance after 2', (await token.balanceOf(infinityStaker.address)).toString());

      infinityRewardsBalance = infinityRewardsBalance.sub(stakeAmount.mul(2));
      totalRewardEarned = totalRewardEarned.sub(stakeAmount);
      expect(await token.balanceOf(infinityTradingRewards.address)).to.equal(infinityRewardsBalance);
      expect(await infinityTradingRewards.earnedRewards(signer1.address, token.address)).to.equal(totalRewardEarned);
      expect(await infinityTradingRewards.earnedRewards(signer2.address, token.address)).to.equal(totalRewardEarned);

      expect(await infinityStaker.getUserTotalStaked(signer1.address)).to.equal(stakeAmount.add(userStaked1));
      expect(await infinityStaker.getUserTotalStaked(signer2.address)).to.equal(stakeAmount.add(userStaked2));

      const totalStaked = amountStaked2.add(stakeAmount.mul(2));
      expect(await token.balanceOf(infinityStaker.address)).to.equal(totalStaked);
    });
  });
});
