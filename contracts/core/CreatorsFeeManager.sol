// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IERC165, IERC2981} from '@openzeppelin/contracts/interfaces/IERC2981.sol';

import {IFeeManager} from '../interfaces/IFeeManager.sol';
import {IRoyaltyEngine} from '../interfaces/IRoyaltyEngine.sol';

/**
 * @title CreatorsFeeManager
 * @notice handles creator fees aka royalties
 */
contract CreatorsFeeManager is IFeeManager, Ownable {
  // https://eips.ethereum.org/EIPS/eip-2981
  bytes4 public constant INTERFACE_ID_ERC2981 = 0x2a55205a;
  string public PARTY_NAME = 'creators';

  IRoyaltyEngine public royaltyEngine;

  event NewRoyaltyEngine(address newEngine);

  /**
   * @notice Constructor
   * @param _royaltyEngine address of the RoyaltyEngine
   */
  constructor(address _royaltyEngine) {
    royaltyEngine = IRoyaltyEngine(_royaltyEngine);
  }

  /**
   * @notice Calculate creator fees and get recipients
   * @param collection address of the NFT contract
   * @param tokenId tokenId
   * @param amount amount to transfer
   */
  function calcFeesAndGetRecipients(
    address,
    address collection,
    uint256 tokenId,
    uint256 amount
  )
    external
    override
    returns (
      string memory,
      address[] memory,
      uint256[] memory
    )
  {
    address[] memory recipients;
    uint256[] memory royaltyAmounts;
    // check if the collection supports IERC2981
    if (IERC165(collection).supportsInterface(INTERFACE_ID_ERC2981)) {
      (recipients[0], royaltyAmounts[0]) = IERC2981(collection).royaltyInfo(tokenId, amount);
    } else {
      // lookup from royaltyregistry.eth
      (recipients, royaltyAmounts) = royaltyEngine.getRoyalty(collection, tokenId, amount);
    }
    return (PARTY_NAME, recipients, royaltyAmounts);
  }

  function updateRoyaltyEngine(address _royaltyEngine) external onlyOwner {
    royaltyEngine = IRoyaltyEngine(_royaltyEngine);
    emit NewRoyaltyEngine(_royaltyEngine);
  }
}