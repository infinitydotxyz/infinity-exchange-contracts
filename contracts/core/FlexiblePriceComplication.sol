// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {OrderTypes, Utils} from '../libraries/Utils.sol';
import {IComplication} from '../interfaces/IComplication.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';

/**
 * @title FlexiblePriceComplication
 * @notice Complication that executes an order at a increasing/decreasing price that can be taken either by a buy or an sell
 */
contract FlexiblePriceComplication is IComplication, Ownable {
  uint256 public immutable PROTOCOL_FEE;
  uint256 public ERROR_BOUND; // error bound for prices in wei

  event NewErrorbound(uint256 errorBound);

  /**
   * @notice Constructor
   * @param _protocolFee protocol fee (200 --> 2%, 400 --> 4%)
   * @param _errorBound price error bound in wei
   */
  constructor(uint256 _protocolFee, uint256 _errorBound) {
    PROTOCOL_FEE = _protocolFee;
    ERROR_BOUND = _errorBound;
  }

  /**
   * @notice Check whether a taker accept order can be executed against a maker offer
   * @param accept taker accept order
   * @param offer maker offer
   * @return (whether complication can be executed, tokenId to execute, amount of tokens to execute)
   */
  function canExecuteOffer(OrderTypes.Taker calldata accept, OrderTypes.Maker calldata offer)
    external
    view
    override
    returns (
      bool,
      uint256,
      uint256
    )
  {
    uint256 currentPrice = Utils.calculateCurrentPrice(offer);
    (uint256 startTime, uint256 endTime) = abi.decode(offer.startAndEndTimes, (uint256, uint256));
    (uint256 tokenId, uint256 amount) = abi.decode(offer.tokenInfo, (uint256, uint256));
    return (
      (Utils.arePricesWithinErrorBound(currentPrice, accept.price, ERROR_BOUND) &&
        (tokenId == accept.tokenId) &&
        (startTime <= block.timestamp) &&
        (endTime >= block.timestamp)),
      tokenId,
      amount
    );
  }

  /**
   * @notice Check whether a taker buy order can be executed against a maker listing
   * @param buy taker buy order
   * @param listing maker listing
   * @return (whether complication can be executed, tokenId to execute, amount of tokens to execute)
   */
  function canExecuteListing(OrderTypes.Taker calldata buy, OrderTypes.Maker calldata listing)
    external
    view
    override
    returns (
      bool,
      uint256,
      uint256
    )
  {
    uint256 currentPrice = Utils.calculateCurrentPrice(listing);
    (uint256 startTime, uint256 endTime) = abi.decode(listing.startAndEndTimes, (uint256, uint256));
    (uint256 tokenId, uint256 amount) = abi.decode(listing.tokenInfo, (uint256, uint256));
    return (
      (Utils.arePricesWithinErrorBound(currentPrice, buy.price, ERROR_BOUND) &&
        (tokenId == buy.tokenId) &&
        (startTime <= block.timestamp) &&
        (endTime >= block.timestamp)),
      tokenId,
      amount
    );
  }

  /**
   * @notice Return protocol fee for this complication
   * @return protocol fee
   */
  function getProtocolFee() external view override returns (uint256) {
    return PROTOCOL_FEE;
  }

  function setErrorBound(uint256 _errorBound) external onlyOwner {
    ERROR_BOUND = _errorBound;
    emit NewErrorbound(_errorBound);
  }
}