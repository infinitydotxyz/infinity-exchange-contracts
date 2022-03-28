// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import '../interfaces/ITimelockConfig.sol';

contract TimelockConfig is ITimelockConfig {
  using EnumerableSet for EnumerableSet.Bytes32Set;

  /* constants */

  bytes32 public constant ADMIN_CONFIG_ID = keccak256('Admin');
  bytes32 public constant TIMELOCK_CONFIG_ID = keccak256('Timelock');

  /* storage */

  struct InternalPending {
    uint256 value;
    uint256 timestamp;
  }

  mapping(bytes32 => uint256) _config;
  EnumerableSet.Bytes32Set _configSet;

  mapping(bytes32 => InternalPending) _pending;
  EnumerableSet.Bytes32Set _pendingSet;

  /* modifiers */

  modifier onlyAdmin() {
    require(msg.sender == address(uint160(_config[ADMIN_CONFIG_ID])), 'only admin');
    _;
  }

  constructor(address admin, uint256 timelock) {
    _setRawConfig(ADMIN_CONFIG_ID, uint256(uint160((admin))));
    _setRawConfig(TIMELOCK_CONFIG_ID, timelock);
  }

  // =============================================== user functions =========================================================

  function confirmChange(bytes32 configID) external override {
    //require existing pending configID
    require(isPending(configID), 'No pending configID found');

    // require sufficient time elapsed
    require(block.timestamp >= _pending[configID].timestamp + _config[TIMELOCK_CONFIG_ID], 'too early');

    // get pending value
    uint256 value = _pending[configID].value;

    // commit change
    _configSet.add(configID);
    _config[configID] = value;

    // delete pending
    _pendingSet.remove(configID);
    delete _pending[configID];

    // emit event
    emit ChangeConfirmed(configID, value);
  }

  // =============================================== internal functions =========================================================

  function _setRawConfig(bytes32 configID, uint256 value) internal {
    // commit change
    _configSet.add(configID);
    _config[configID] = value;

    // emit event
    emit ChangeRequested(configID, value);
    emit ChangeConfirmed(configID, value);
  }

  // =============================================== view functions =========================================================

  function calculateConfigID(string memory name) external pure override returns (bytes32 configID) {
    return keccak256(abi.encodePacked(name));
  }

  function isConfig(bytes32 configID) external view override returns (bool status) {
    return _configSet.contains(configID);
  }

  function getConfigCount() external view override returns (uint256 count) {
    return _configSet.length();
  }

  function getConfigByIndex(uint256 index) external view override returns (ITimelockConfig.Config memory config) {
    // get config ID
    bytes32 configID = _configSet.at(index);
    // return config
    return ITimelockConfig.Config(configID, _config[configID]);
  }

  function getConfig(bytes32 configID) public view override returns (ITimelockConfig.Config memory config) {
    // check for existance
    require(_configSet.contains(configID), 'not config');
    // return config
    return ITimelockConfig.Config(configID, _config[configID]);
  }

  function isPending(bytes32 configID) public view override returns (bool status) {
    return _pendingSet.contains(configID);
  }

  function getPendingCount() external view override returns (uint256 count) {
    return _pendingSet.length();
  }

  function getPendingByIndex(uint256 index)
    external
    view
    override
    returns (ITimelockConfig.PendingRequest memory pendingRequest)
  {
    // get config ID
    bytes32 configID = _pendingSet.at(index);
    // return config
    return ITimelockConfig.PendingRequest(configID, _pending[configID].value, _pending[configID].timestamp);
  }

  function getPending(bytes32 configID)
    external
    view
    override
    returns (ITimelockConfig.PendingRequest memory pendingRequest)
  {
    // check for existance
    require(_pendingSet.contains(configID), 'not pending');
    // return config
    return ITimelockConfig.PendingRequest(configID, _pending[configID].value, _pending[configID].timestamp);
  }

  // =============================================== admin functions =========================================================

  function requestChange(bytes32 configID, uint256 value) external override onlyAdmin {
    // add to pending set
    require(_pendingSet.add(configID), 'request already exists');

    // lock new value
    _pending[configID] = InternalPending(value, block.timestamp);

    // emit event
    emit ChangeRequested(configID, value);
  }

  function cancelChange(bytes32 configID) external override onlyAdmin {
    // remove from pending set
    require(_pendingSet.remove(configID), 'no pending request');

    // get pending value
    uint256 value = _pending[configID].value;

    // delete pending
    delete _pending[configID];

    // emit event
    emit ChangeCanceled(configID, value);
  }
}
