// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFeeRegistry {
  function registerFeeDestination(
    address collection,
    address setter,
    address destination,
    uint32 bps
  ) external;

  function getFeeInfo(address collection)
    external
    view
    returns (
      address,
      address,
      uint32
    );
}