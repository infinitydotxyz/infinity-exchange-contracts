// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {OrderTypes} from '../libs/OrderTypes.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {IInfinityFeeTreasury} from '../interfaces/IInfinityFeeTreasury.sol';
import {IInfinityTradingRewards} from '../interfaces/IInfinityTradingRewards.sol';
import {SignatureChecker} from '../libs/SignatureChecker.sol';
import {IERC165} from '@openzeppelin/contracts/interfaces/IERC165.sol';
import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import {IERC1155} from '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import {IERC20, SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IFeeManager, FeeParty} from '../interfaces/IFeeManager.sol';

// import 'hardhat/console.sol'; // todo: remove this

/**
 * @title InfinityExchange

NFTNFTNFT...........................................NFTNFTNFT
NFTNFT                                                 NFTNFT
NFT                                                       NFT
.                                                           .
.                                                           .
.                                                           .
.                                                           .
.               NFTNFTNFT            NFTNFTNFT              .
.            NFTNFTNFTNFTNFT      NFTNFTNFTNFTNFT           .
.           NFTNFTNFTNFTNFTNFT   NFTNFTNFTNFTNFTNFT         .
.         NFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFT        .
.         NFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFT        .
.         NFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFTNFT        .
.          NFTNFTNFTNFTNFTNFTN   NFTNFTNFTNFTNFTNFT         .
.            NFTNFTNFTNFTNFT      NFTNFTNFTNFTNFT           .
.               NFTNFTNFT            NFTNFTNFT              .
.                                                           .
.                                                           .
.                                                           .
.                                                           .
NFT                                                       NFT
NFTNFT                                                 NFTNFT
NFTNFTNFT...........................................NFTNFTNFT 

*/
contract InfinityExchangeSimple is ReentrancyGuard, Ownable {
  using OrderTypes for OrderTypes.SimpleOrder;
  using SafeERC20 for IERC20;

  address public immutable WETH;
  bytes32 public immutable DOMAIN_SEPARATOR;

  IInfinityFeeTreasury public infinityFeeTreasury;
  IInfinityTradingRewards public infinityTradingRewards;

  mapping(address => uint256) public userMinOrderNonce;
  mapping(address => mapping(uint256 => bool)) private _isUserOrderNonceExecutedOrCancelled;
  address matchExecutor;

  // creator address to currency to amount
  mapping(address => mapping(address => uint256)) public creatorFees;
  // currency to amount
  mapping(address => uint256) public curatorFees;
  address public CREATOR_FEE_MANAGER;

  uint16 public CURATOR_FEE_BPS = 150;

  event CancelAllOrders(address user, uint256 newMinNonce);
  event CancelMultipleOrders(address user, uint256[] orderNonces);
  event NewInfinityFeeTreasury(address infinityFeeTreasury);
  event NewInfinityTradingRewards(address infinityTradingRewards);
  event NewMatchExecutor(address matchExecutor);

  event OrderFulfilled(
    bytes32 sellOrderHash, // hash of the sell order
    bytes32 buyOrderHash, // hash of the sell order
    address indexed seller,
    address indexed buyer,
    address currency, // token address of the transacting currency
    address collection,
    uint256 tokenId,
    uint256 numTokens,
    uint256 amount // amount spent on the order
  );

  /**
   * @notice Constructor
   * @param _WETH wrapped ether address (for other chains, use wrapped native asset)
   * @param _matchExecutor executor address for matches
   */
  constructor(address _WETH, address _matchExecutor) {
    // Calculate the domain separator
    DOMAIN_SEPARATOR = keccak256(
      abi.encode(
        keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
        keccak256('InfinityExchangeSimple'),
        keccak256(bytes('1')), // for versionId = 1
        block.chainid,
        address(this)
      )
    );
    WETH = _WETH;
    matchExecutor = _matchExecutor;
  }

  // =================================================== USER FUNCTIONS =======================================================

  /**
   * @notice Cancel all pending orders
   * @param minNonce minimum user nonce
   */
  function cancelAllOrders(uint256 minNonce) external {
    // console.log('user min order nonce', msg.sender, userMinOrderNonce[msg.sender]);
    // console.log('new min order nonce', msg.sender, minNonce);
    require(minNonce > userMinOrderNonce[msg.sender], 'Cancel: Nonce too low');
    require(minNonce < userMinOrderNonce[msg.sender] + 1000000, 'Cancel: Too many');
    userMinOrderNonce[msg.sender] = minNonce;
    emit CancelAllOrders(msg.sender, minNonce);
  }

  /**
   * @notice Cancel multiple orders
   * @param orderNonces array of order nonces
   */
  function cancelMultipleOrders(uint256[] calldata orderNonces) external {
    require(orderNonces.length > 0, 'Cancel: Cannot be empty');
    // console.log('user min order nonce', msg.sender, userMinOrderNonce[msg.sender]);
    for (uint256 i = 0; i < orderNonces.length; i++) {
      // console.log('order nonce', orderNonces[i]);
      require(orderNonces[i] > userMinOrderNonce[msg.sender], 'Cancel: Nonce too low');
      require(
        !_isUserOrderNonceExecutedOrCancelled[msg.sender][orderNonces[i]],
        'Cancel: Nonce already executed or cancelled'
      );
      _isUserOrderNonceExecutedOrCancelled[msg.sender][orderNonces[i]] = true;
    }
    emit CancelMultipleOrders(msg.sender, orderNonces);
  }

  // function matchOrders(
  //   OrderTypes.SimpleOrder[] calldata sells,
  //   OrderTypes.SimpleOrder[] calldata buys,
  //   OrderTypes.SimpleOrder[] calldata constructs,
  //   bool tradingRewards,
  //   bool feeDiscountEnabled
  // ) external override nonReentrant {
  //   uint256 startGas = gasleft();
  //   // check pre-conditions
  //   require(sells.length == buys.length, 'Match orders: mismatched lengths');
  //   require(sells.length == constructs.length, 'Match orders: mismatched lengths');

  //   if (tradingRewards) {
  //     address[] memory sellers = new address[](sells.length);
  //     address[] memory buyers = new address[](sells.length);
  //     address[] memory currencies = new address[](sells.length);
  //     uint256[] memory amounts = new uint256[](sells.length);
  //     // execute orders one by one
  //     for (uint256 i = 0; i < sells.length; ) {
  //       (sellers[i], buyers[i], currencies[i], amounts[i]) = _matchOrders(
  //         sells[i],
  //         buys[i],
  //         constructs[i],
  //         feeDiscountEnabled
  //       );
  //       unchecked {
  //         ++i;
  //       }
  //     }
  //     infinityTradingRewards.updateRewards(sellers, buyers, currencies, amounts);
  //   } else {
  //     for (uint256 i = 0; i < sells.length; ) {
  //       _matchOrders(sells[i], buys[i], constructs[i], feeDiscountEnabled);
  //       unchecked {
  //         ++i;
  //       }
  //     }
  //   }
  //   // refund gas to match executor
  //   infinityFeeTreasury.refundMatchExecutionGasFee(startGas, sells, matchExecutor, WETH);
  // }
  function simpleTakeOrders(
    OrderTypes.SimpleOrder calldata makerOrder,
    OrderTypes.SimpleOrder calldata takerOrder,
    bool tradingRewards,
    bool feeDiscountEnabled
  ) external nonReentrant {
    if (tradingRewards) {
      // console.log('trading rewards enabled');
      address[] memory sellers = new address[](1);
      address[] memory buyers = new address[](1);
      address[] memory currencies = new address[](1);
      uint256[] memory amounts = new uint256[](1);
      // execute orders one by one
      (sellers[0], buyers[0], currencies[0], amounts[0]) = _takeOrders(makerOrder, takerOrder, feeDiscountEnabled);
      infinityTradingRewards.updateRewards(sellers, buyers, currencies, amounts);
    } else {
      // console.log('no trading rewards');
      _takeOrders(makerOrder, takerOrder, feeDiscountEnabled);
    }
  }

  // ====================================================== VIEW FUNCTIONS ======================================================

  /**
   * @notice Check whether user order nonce is executed or cancelled
   * @param user address of user
   * @param nonce nonce of the order
   */
  function isNonceValid(address user, uint256 nonce) external view returns (bool) {
    return !_isUserOrderNonceExecutedOrCancelled[user][nonce] && nonce > userMinOrderNonce[user];
  }

  function verifyOrderSig(OrderTypes.SimpleOrder calldata order) external view returns (bool) {
    // Verify the validity of the signature
    // console.log('verifying order signature');
    (bytes32 r, bytes32 s, uint8 v) = abi.decode(order.sig, (bytes32, bytes32, uint8));
    // console.log('domain sep:');
    // console.logBytes32(DOMAIN_SEPARATOR);
    // console.log('signature:');
    // console.logBytes32(r);
    // console.logBytes32(s);
    // console.log(v);
    // console.log('signer', order.signer);
    return SignatureChecker.verify(_hash(order), order.signer, r, s, v, DOMAIN_SEPARATOR);
  }

  // ====================================================== INTERNAL FUNCTIONS ================================================

  // function _matchOrders(
  //   OrderTypes.SimpleOrder calldata sell,
  //   OrderTypes.SimpleOrder calldata buy,
  //   OrderTypes.SimpleOrder calldata constructed,
  //   bool feeDiscountEnabled
  // )
  //   internal
  //   returns (
  //     address,
  //     address,
  //     address,
  //     uint256
  //   )
  // {
  //   bytes32 sellOrderHash = _hash(sell);
  //   bytes32 buyOrderHash = _hash(buy);

  //   // if this order is not valid, just return and continue with other orders
  //   (bool orderVerified, uint256 execPrice) = _verifyOrders(sellOrderHash, buyOrderHash, sell, buy, constructed);
  //   if (!orderVerified) {
  //     // console.log('skipping invalid order');
  //     return (address(0), address(0), address(0), 0);
  //   }

  //   return _execMatchOrders(sellOrderHash, buyOrderHash, sell, buy, constructed, execPrice, feeDiscountEnabled);
  // }

  // function _execMatchOrders(
  //   bytes32 sellOrderHash,
  //   bytes32 buyOrderHash,
  //   OrderTypes.SimpleOrder calldata sell,
  //   OrderTypes.SimpleOrder calldata buy,
  //   OrderTypes.SimpleOrder calldata constructed,
  //   uint256 execPrice,
  //   bool feeDiscountEnabled
  // )
  //   internal
  //   returns (
  //     address,
  //     address,
  //     address,
  //     uint256
  //   )
  // {
  //   // exec order
  //   return
  //     _execOrder(
  //       sellOrderHash,
  //       buyOrderHash,
  //       sell.signer,
  //       buy.signer,
  //       sell.constraints[6],
  //       buy.constraints[6],
  //       sell.constraints[5],
  //       constructed,
  //       execPrice,
  //       feeDiscountEnabled
  //     );
  // }

  function _takeOrders(
    OrderTypes.SimpleOrder calldata makerOrder,
    OrderTypes.SimpleOrder calldata takerOrder,
    bool feeDiscountEnabled
  )
    internal
    returns (
      address,
      address,
      address,
      uint256
    )
  {
    // console.log('taking order');
    bytes32 makerOrderHash = _hash(makerOrder);
    bytes32 takerOrderHash = _hash(takerOrder);

    // if this order is not valid, just return and continue with other orders
    bool orderVerified = _verifyTakeOrders(makerOrderHash, makerOrder, takerOrder);
    if (!orderVerified) {
      // console.log('skipping invalid order');
      return (address(0), address(0), address(0), 0);
    }

    // exec order
    return _exectakeOrders(makerOrderHash, takerOrderHash, makerOrder, takerOrder, feeDiscountEnabled);
  }

  function _exectakeOrders(
    bytes32 makerOrderHash,
    bytes32 takerOrderHash,
    OrderTypes.SimpleOrder calldata makerOrder,
    OrderTypes.SimpleOrder calldata takerOrder,
    bool feeDiscountEnabled
  )
    internal
    returns (
      address,
      address,
      address,
      uint256
    )
  {
    // exec order
    bool isTakerSell = takerOrder.isSellOrder;
    if (isTakerSell) {
      return _execTakerSellOrder(takerOrderHash, makerOrderHash, takerOrder, makerOrder, feeDiscountEnabled);
    } else {
      return _execTakerBuyOrder(takerOrderHash, makerOrderHash, takerOrder, makerOrder, feeDiscountEnabled);
    }
  }

  function _execTakerSellOrder(
    bytes32 takerOrderHash,
    bytes32 makerOrderHash,
    OrderTypes.SimpleOrder calldata takerOrder,
    OrderTypes.SimpleOrder calldata makerOrder,
    bool feeDiscountEnabled
  )
    internal
    returns (
      address,
      address,
      address,
      uint256
    )
  {
    // console.log('executing taker sell order');
    return
      _execOrder(
        takerOrderHash,
        makerOrderHash,
        takerOrder.signer,
        makerOrder.signer,
        takerOrder.nonce,
        makerOrder.nonce,
        takerOrder.minBpsToSeller,
        takerOrder,
        takerOrder.price,
        feeDiscountEnabled
      );
  }

  function _execTakerBuyOrder(
    bytes32 takerOrderHash,
    bytes32 makerOrderHash,
    OrderTypes.SimpleOrder calldata takerOrder,
    OrderTypes.SimpleOrder calldata makerOrder,
    bool feeDiscountEnabled
  )
    internal
    returns (
      address,
      address,
      address,
      uint256
    )
  {
    // console.log('executing taker buy order');
    return
      _execOrder(
        makerOrderHash,
        takerOrderHash,
        makerOrder.signer,
        takerOrder.signer,
        makerOrder.nonce,
        takerOrder.nonce,
        makerOrder.minBpsToSeller,
        takerOrder,
        takerOrder.price,
        feeDiscountEnabled
      );
  }

  // function _verifyOrders(
  //   bytes32 sellOrderHash,
  //   bytes32 buyOrderHash,
  //   OrderTypes.SimpleOrder calldata sell,
  //   OrderTypes.SimpleOrder calldata buy,
  //   OrderTypes.SimpleOrder calldata constructed
  // ) internal view returns (bool, uint256) {
  //   // console.log('verifying match orders');
  //   bool sidesMatch = sell.isSellOrder && !buy.isSellOrder;
  //   bool complicationsMatch = sell.execParams[0] == buy.execParams[0];
  //   bool currenciesMatch = sell.execParams[1] == buy.execParams[1];
  //   bool sellOrderValid = _isOrderValid(sell, sellOrderHash);
  //   bool buyOrderValid = _isOrderValid(buy, buyOrderHash);
  //   (bool executionValid, uint256 execPrice) = IComplication(sell.execParams[0]).canExecOrder(sell, buy, constructed);
  //   // console.log('sidesMatch', sidesMatch);
  //   // console.log('complicationsMatch', complicationsMatch);
  //   // console.log('currenciesMatch', currenciesMatch);
  //   // console.log('sellOrderValid', sellOrderValid);
  //   // console.log('buyOrderValid', buyOrderValid);
  //   // console.log('executionValid', executionValid);
  //   return (
  //     sidesMatch && complicationsMatch && currenciesMatch && sellOrderValid && buyOrderValid && executionValid,
  //     execPrice
  //   );
  // }

  function _verifyTakeOrders(
    bytes32 makerOrderHash,
    OrderTypes.SimpleOrder calldata maker,
    OrderTypes.SimpleOrder calldata taker
  ) internal view returns (bool) {
    // console.log('verifying take orders');
    bool msgSenderIsTaker = msg.sender == taker.signer;
    bool sidesMatch = (maker.isSellOrder && !taker.isSellOrder) || (!maker.isSellOrder && taker.isSellOrder);
    bool currenciesMatch = maker.currency == taker.currency;
    bool makerOrderValid = _isOrderValid(maker, makerOrderHash);
    bool executionValid = _canExecTakeOrder(maker, taker);
    // console.log('msgSenderIsTaker', msgSenderIsTaker);
    // console.log('sidesMatch', sidesMatch);
    // console.log('currenciesMatch', currenciesMatch);
    // console.log('makerOrderValid', makerOrderValid);
    // console.log('executionValid', executionValid);
    return msgSenderIsTaker && sidesMatch && currenciesMatch && makerOrderValid && executionValid;
  }

  function _canExecTakeOrder(OrderTypes.SimpleOrder calldata makerOrder, OrderTypes.SimpleOrder calldata takerOrder)
    internal
    view
    returns (bool)
  {
    // console.log('running canExecTakeOrder');
    bool isTimeValid = makerOrder.endTime >= block.timestamp;
    bool isAmountValid = makerOrder.price == takerOrder.price;
    bool itemsIntersect = makerOrder.collection == takerOrder.collection &&
      makerOrder.tokenId == takerOrder.tokenId &&
      makerOrder.numTokens == takerOrder.numTokens;
    // console.log('isTimeValid', isTimeValid);
    // console.log('isAmountValid', isAmountValid);
    // console.log('itemsIntersect', itemsIntersect);

    return isTimeValid && isAmountValid && itemsIntersect;
  }

  /**
   * @notice Verifies the validity of the order
   * @param order the order
   * @param orderHash computed hash of the order
   */
  function _isOrderValid(OrderTypes.SimpleOrder calldata order, bytes32 orderHash) internal view returns (bool) {
    return _orderValidity(order.signer, order.sig, orderHash, order.currency, order.nonce);
  }

  function _orderValidity(
    address signer,
    bytes calldata sig,
    bytes32 orderHash,
    address currency,
    uint256 nonce
  ) internal view returns (bool) {
    // console.log('checking order validity');
    bool orderExpired = _isUserOrderNonceExecutedOrCancelled[signer][nonce] || nonce < userMinOrderNonce[signer];
    // console.log('order expired:', orderExpired);
    // Verify the validity of the signature
    (bytes32 r, bytes32 s, uint8 v) = abi.decode(sig, (bytes32, bytes32, uint8));
    bool sigValid = SignatureChecker.verify(orderHash, signer, r, s, v, DOMAIN_SEPARATOR);

    if (orderExpired || !sigValid || signer == address(0) || currency != WETH) {
      return false;
    }
    return true;
  }

  function _execOrder(
    bytes32 sellOrderHash,
    bytes32 buyOrderHash,
    address seller,
    address buyer,
    uint256 sellNonce,
    uint256 buyNonce,
    uint256 minBpsToSeller,
    OrderTypes.SimpleOrder calldata constructed,
    uint256 execPrice,
    bool feeDiscountEnabled
  )
    internal
    returns (
      address,
      address,
      address,
      uint256
    )
  {
    // console.log('executing order');
    // Update order execution status to true (prevents replay)
    _isUserOrderNonceExecutedOrCancelled[seller][sellNonce] = true;
    _isUserOrderNonceExecutedOrCancelled[buyer][buyNonce] = true;

    _transferNFTsAndFees(seller, buyer, minBpsToSeller, constructed, feeDiscountEnabled);

    _emitEvent(sellOrderHash, buyOrderHash, seller, buyer, constructed, execPrice);

    return (seller, buyer, constructed.currency, constructed.price);
  }

  function _emitEvent(
    bytes32 sellOrderHash,
    bytes32 buyOrderHash,
    address seller,
    address buyer,
    OrderTypes.SimpleOrder calldata constructed,
    uint256 amount
  ) internal {
    emit OrderFulfilled(
      sellOrderHash,
      buyOrderHash,
      seller,
      buyer,
      constructed.currency,
      constructed.collection,
      constructed.tokenId,
      constructed.numTokens,
      amount
    );
  }

  function _transferNFTsAndFees(
    address seller,
    address buyer,
    uint256 minBpsToSeller,
    OrderTypes.SimpleOrder calldata constructed,
    bool feeDiscountEnabled
  ) internal {
    // console.log('transfering nfts and fees');
    // transfer NFTs
    _transferNFT(seller, buyer, constructed);
    // transfer fees
    OrderTypes.OrderItem[] memory nfts = new OrderTypes.OrderItem[](1);
    OrderTypes.TokenInfo[] memory tokens = new OrderTypes.TokenInfo[](1);
    OrderTypes.TokenInfo memory tokenInfo = OrderTypes.TokenInfo(constructed.tokenId, constructed.numTokens);
    tokens[0] = tokenInfo;
    OrderTypes.OrderItem memory item = OrderTypes.OrderItem(constructed.collection, tokens);
    nfts[0] = item;
    // _transferFees(seller, buyer, nfts, constructed.price, constructed.currency, minBpsToSeller, feeDiscountEnabled);
    _transferFees(seller, buyer, constructed, minBpsToSeller, feeDiscountEnabled);
  }

  function _transferNFT(
    address from,
    address to,
    OrderTypes.SimpleOrder calldata constructed
  ) internal {
    if (IERC165(constructed.collection).supportsInterface(0x80ac58cd)) {
      IERC721(constructed.collection).safeTransferFrom(from, to, constructed.tokenId);
    } else if (IERC165(constructed.collection).supportsInterface(0xd9b67a26)) {
      IERC1155(constructed.collection).safeTransferFrom(from, to, constructed.tokenId, constructed.numTokens, '');
    }
  }

  function _transferFees(
    address seller,
    address buyer,
    OrderTypes.SimpleOrder calldata constructed,
    uint256 minBpsToSeller,
    bool feeDiscountEnabled
  ) internal {
    // console.log('transfering fees');
    // infinityFeeTreasury.allocateFees(
    //   seller,
    //   buyer,
    //   nfts,
    //   amount,
    //   currency,
    //   minBpsToSeller,
    //   address(this),
    //   feeDiscountEnabled
    // );

    // token staker discount
    // console.log('effective fee bps', effectiveFeeBps);

    // creator fee
    uint256 totalFees = _allocateFeesToCreators(address(this), constructed);

    // curator fee
    totalFees += _allocateFeesToCurators(constructed);

    // transfer fees to contract
    // console.log('transferring total fees', totalFees);
    IERC20(constructed.currency).safeTransferFrom(buyer, address(this), totalFees);

    // check min bps to seller is met
    // // console.log('amount:', amount);
    // // console.log('totalFees:', totalFees);
    uint256 remainingAmount = constructed.price - totalFees;
    // // console.log('remainingAmount:', remainingAmount);
    require((remainingAmount * 10000) >= (minBpsToSeller * constructed.price), 'Fees: Higher than expected');
    // transfer final amount (post-fees) to seller
    IERC20(constructed.currency).safeTransferFrom(buyer, seller, remainingAmount);

    // emit events
    // for (uint256 i = 0; i < items.length; ) {
    //   // fee allocated per collection is simply totalFee divided by number of collections in the order
    //   emit FeeAllocated(items[i].collection, currency, totalFees / items.length);
    //   unchecked {
    //     ++i;
    //   }
    // }
  }

  function _allocateFeesToCreators(address execComplication, OrderTypes.SimpleOrder calldata constructed)
    internal
    returns (uint256)
  {
    // console.log('allocating fees to creators');
    // console.log('avg sale price', amount / items.length);
    uint256 creatorsFee = 0;
    IFeeManager feeManager = IFeeManager(CREATOR_FEE_MANAGER);

    (, address[] memory feeRecipients, uint256[] memory feeAmounts) = feeManager.calcFeesAndGetRecipients(
      execComplication,
      constructed.collection,
      0, // to comply with ierc2981 and royalty registry
      constructed.price // amount per collection on avg
    );
    // console.log('collection', items[h].collection, 'num feeRecipients:', feeRecipients.length);
    for (uint256 i = 0; i < feeRecipients.length; ) {
      if (feeRecipients[i] != address(0) && feeAmounts[i] != 0) {
        // console.log('fee amount', i, feeAmounts[i]);
        creatorFees[feeRecipients[i]][constructed.currency] += feeAmounts[i];
        creatorsFee += feeAmounts[i];
      }
      unchecked {
        ++i;
      }
    }
    // console.log('creatorsFee:', creatorsFee);
    return creatorsFee;
  }

  function _allocateFeesToCurators(OrderTypes.SimpleOrder calldata constructed) internal returns (uint256) {
    // console.log('allocating fees to curators');
    uint256 curatorsFee = (CURATOR_FEE_BPS * constructed.price) / 10000;
    // update storage
    curatorFees[constructed.currency] += curatorsFee;
    // console.log('curatorsFee:', curatorsFee);
    return curatorsFee;
  }

  function _hash(OrderTypes.SimpleOrder calldata order) internal pure returns (bytes32) {
    // keccak256('SimpleOrder(bool isSellOrder,address signer,uint256 price,uint256 endTime,uint256 minBpsToSeller,uint256 nonce,address collection,uint256 tokenId,uint256 numTokens,address currency)')
    bytes32 ORDER_HASH = 0x9ee9169a3951f07206ae8b0c0a485be510890da9fdc29e34a1eadf7694afe56d;
    bytes32 orderHash = keccak256(
      abi.encode(
        ORDER_HASH,
        order.isSellOrder,
        order.signer,
        order.price,
        order.endTime,
        order.minBpsToSeller,
        order.nonce,
        order.collection,
        order.tokenId,
        order.numTokens,
        order.currency
      )
    );
    // console.log('order hash:');
    // console.logBytes32(orderHash);
    return orderHash;
  }

  // ====================================================== ADMIN FUNCTIONS ======================================================

  function rescueTokens(
    address destination,
    address currency,
    uint256 amount
  ) external onlyOwner {
    IERC20(currency).safeTransfer(destination, amount);
  }

  function rescueETH(address destination) external payable onlyOwner {
    (bool sent, ) = destination.call{value: msg.value}('');
    require(sent, 'Failed to send Ether');
  }

  /**
   * @notice Update fee distributor
   * @param _infinityFeeTreasury new address
   */
  function updateInfinityFeeTreasury(address _infinityFeeTreasury) external onlyOwner {
    require(_infinityFeeTreasury != address(0), 'Owner: Cannot be 0x0');
    infinityFeeTreasury = IInfinityFeeTreasury(_infinityFeeTreasury);
    emit NewInfinityFeeTreasury(_infinityFeeTreasury);
  }

  function updateInfinityTradingRewards(address _infinityTradingRewards) external onlyOwner {
    require(_infinityTradingRewards != address(0), 'Owner: Cannot be 0x0');
    infinityTradingRewards = IInfinityTradingRewards(_infinityTradingRewards);
    emit NewInfinityTradingRewards(_infinityTradingRewards);
  }

  function updateMatchExecutor(address _matchExecutor) external onlyOwner {
    matchExecutor = _matchExecutor;
    emit NewMatchExecutor(_matchExecutor);
  }

  function updateCreatorFeeManager(address manager) external onlyOwner {
    CREATOR_FEE_MANAGER = manager;
  }
}
