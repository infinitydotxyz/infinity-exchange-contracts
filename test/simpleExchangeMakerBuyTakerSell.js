const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { deployContract } = require('../tasks/utils');
const {
  prepareOBOrder,
  signOBOrder,
  getCurrentSignedOrderPrice,
  approveERC721,
  approveERC20,
  signFormattedOrder,
  prepareSimpleOrder,
  approveERC721Simple,
  signSimpleOrder
} = require('../helpers/orders');
const { nowSeconds, trimLowerCase } = require('@infinityxyz/lib/utils');
const { erc721Abi } = require('../abi/erc721');
const { erc20Abi } = require('../abi/erc20');

describe('Simple_Exchange_Maker_Buy_Taker_Sell', function () {
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

  const buyOrders = [];

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

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  before(async function () {
    this.timeout(100000000);
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

    // Exchange
    infinityExchange = await deployContract(
      'InfinityExchangeSimple',
      await ethers.getContractFactory('InfinityExchangeSimple'),
      signer1,
      [token.address, signer3.address]
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

    // set infinity fee treasury on exchange
    await infinityExchange.updateInfinityFeeTreasury(infinityFeeTreasury.address);
    await infinityExchange.updateCreatorFeeManager(infinityCreatorsFeeManager.address);

    // send assets
    await token.transfer(signer2.address, INITIAL_SUPPLY.div(2).toString());
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

      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      expect(await mock721Contract1.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract1.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract2.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract2.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract3.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract3.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);
    });
  });

  // ================================================== MAKE BUY ORDERS ==================================================

  // one specific collection, one specific token, max price
  describe('OneCollectionOneTokenBuy', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId;
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        price: ethers.utils.parseEther('1'),
        endTime: nowSeconds().add(10 * 60),
        minBpsToSeller: 9000,
        nonce,
        collection: mock721Contract1.address,
        tokenId: 0,
        numTokens: 1,
        currency: token.address
      };
      const signedOrder = await prepareSimpleOrder(
        user,
        chainId,
        signer1,
        order,
        infinityExchange,
        infinityFeeTreasury.address
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // ================================================== TAKE BUY ORDERS ===================================================

  describe('Take_OneCollectionOneTokenBuy', () => {
    it('Should take valid order', async function () {
      const signedBuyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId;
      const contractAddress = infinityExchange.address;
      const isSellOrder = true;

      // approve NFTs
      await approveERC721Simple(signer2.address, signedBuyOrder.collection, signer2, infinityExchange.address);

      // sign order
      const orderId = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [signer2.address, signedBuyOrder.nonce, chainId]
      );
      const orderToSign = {
        id: orderId,
        chainId,
        signerAddress: signer2.address,
        isSellOrder,
        signer: signer2.address,
        price: signedBuyOrder.price,
        endTime: signedBuyOrder.endTime,
        minBpsToSeller: signedBuyOrder.minBpsToSeller,
        nonce: signedBuyOrder.nonce,
        collection: signedBuyOrder.collection,
        tokenId: signedBuyOrder.tokenId,
        numTokens: signedBuyOrder.numTokens,
        currency: signedBuyOrder.currency
      };
      const signedSellOrder = await signSimpleOrder(chainId, contractAddress, orderToSign, signer2);

      console.log('verifying signedSellOrder', signedSellOrder);
      const isSigValid = await infinityExchange.verifyOrderSig(signedSellOrder);
      expect(isSigValid).to.equal(true);

      // owners before sale
      console.log('owners before sale');
      const collection = orderToSign.collection;
      const contract = new ethers.Contract(collection, erc721Abi, signer1);
      const tokenId = orderToSign.tokenId;
      expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);

      // sale price
      const salePrice = orderToSign.price;
      await approveERC20(signer1.address, signedSellOrder.currency, salePrice, signer1, infinityExchange.address);

      // balance before sale
      console.log('balances before sale');
      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      // perform exchange
      console.log('perform exchange');
      await infinityExchange.connect(signer2).simpleTakeOrders(signedBuyOrder, signedSellOrder, false, false);

      // owners after sale
      console.log('owners after sale');
      expect(await contract.ownerOf(orderToSign.tokenId)).to.equal(signer1.address);

      // balance after sale
      const fee = salePrice.mul(CURATOR_FEE_BPS).div(10000);
      totalCuratorFees = totalCuratorFees.add(fee);
      expect(await token.balanceOf(infinityFeeTreasury.address)).to.equal(totalCuratorFees);
      signer1Balance = INITIAL_SUPPLY.div(2).sub(salePrice);
      signer2Balance = INITIAL_SUPPLY.div(2).add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });
});
