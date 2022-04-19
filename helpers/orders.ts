import { BigNumber, BigNumberish, BytesLike, constants, Contract } from 'ethers';
import { defaultAbiCoder, keccak256, solidityKeccak256, splitSignature, _TypedDataEncoder } from 'ethers/lib/utils';
import { infinityExchangeAbi } from '../abi/infinityExchange';
import { erc721Abi } from '../abi/erc721';
import { nowSeconds, trimLowerCase } from '@infinityxyz/lib/utils';
import { erc20Abi } from '../abi/erc20';
import { JsonRpcSigner } from '@ethersproject/providers';
import { OBOrder, ChainOBOrder, ExecParams, ExtraParams, OBOrderItem, OBTokenInfo } from '@infinityxyz/lib/types/core';

// types
export type User = {
  address: string;
};

// export interface TokenInfo {
//   tokenId: BigNumberish;
//   numTokens: BigNumberish;
// }

// export interface OrderItem {
//   collection: string;
//   tokens: TokenInfo[];
// }

// export interface ExecParams {
//   complicationAddress: string;
//   currencyAddress: string;
// }

// export interface ExtraParams {
//   buyer?: string;
// }

// export interface OBOrder {
//   id: string;
//   chainId: BigNumberish;
//   isSellOrder: boolean;
//   signerAddress: string;
//   numItems: BigNumberish;
//   startPrice: BigNumberish;
//   endPrice: BigNumberish;
//   startTime: BigNumberish;
//   endTime: BigNumberish;
//   minBpsToSeller: BigNumberish;
//   nonce: BigNumberish;
//   nfts: OrderItem[];
//   execParams: ExecParams;
//   extraParams: ExtraParams;
// }

// export interface ChainOBOrder {
//   isSellOrder: boolean;
//   signer: string;
//   constraints: BigNumberish[];
//   nfts: OrderItem[];
//   execParams: string[];
//   extraParams: BytesLike;
//   sig: BytesLike;
// }

// constants
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const getCurrentOrderPrice = (order: Partial<OBOrder>): BigNumber => {
  const startTime = BigNumber.from(order.startTimeMs);
  const endTime = BigNumber.from(order.endTimeMs);
  const startPrice = BigNumber.from(order.startPriceWei);
  const endPrice = BigNumber.from(order.endPriceWei);
  const duration = endTime.sub(startTime);
  let priceDiff = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    priceDiff = startPrice.sub(endPrice);
  } else {
    priceDiff = endPrice.sub(startPrice);
  }
  if (priceDiff.eq(0) || duration.eq(0)) {
    return startPrice;
  }
  const elapsedTime = BigNumber.from(Date.now()).sub(startTime.toNumber());
  const precision = 10000;
  const portion = elapsedTime.gt(duration) ? 1 : elapsedTime.mul(precision).div(duration);
  priceDiff = priceDiff.mul(portion).div(precision);
  let currentPrice = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    currentPrice = startPrice.sub(priceDiff);
  } else {
    currentPrice = startPrice.add(priceDiff);
  }
  return currentPrice;
};

export const getCurrentSignedOrderPrice = (order: ChainOBOrder): BigNumber => {
  const startPrice = BigNumber.from(order.constraints[1]);
  const endPrice = BigNumber.from(order.constraints[2]);
  const startTime = BigNumber.from(order.constraints[3]);
  const endTime = BigNumber.from(order.constraints[4]);
  const duration = endTime.sub(startTime);
  let priceDiff = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    priceDiff = startPrice.sub(endPrice);
  } else {
    priceDiff = endPrice.sub(startPrice);
  }
  if (priceDiff.eq(0) || duration.eq(0)) {
    return startPrice;
  }
  const elapsedTime = BigNumber.from(nowSeconds()).sub(startTime);
  const precision = 10000;
  const portion = elapsedTime.gt(duration) ? 1 : elapsedTime.mul(precision).div(duration);
  priceDiff = priceDiff.mul(portion).div(precision);
  let currentPrice = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    currentPrice = startPrice.sub(priceDiff);
  } else {
    currentPrice = startPrice.add(priceDiff);
  }
  return currentPrice;
};

export const calculateSignedOrderPriceAt = (timestamp: BigNumber, order: ChainOBOrder): BigNumber => {
  const startPrice = BigNumber.from(order.constraints[1]);
  const endPrice = BigNumber.from(order.constraints[2]);
  const startTime = BigNumber.from(order.constraints[3]);
  const endTime = BigNumber.from(order.constraints[4]);
  const duration = endTime.sub(startTime);
  let priceDiff = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    priceDiff = startPrice.sub(endPrice);
  } else {
    priceDiff = endPrice.sub(startPrice);
  }
  if (priceDiff.eq(0) || duration.eq(0)) {
    return startPrice;
  }
  const elapsedTime = BigNumber.from(timestamp).sub(startTime);
  console.log('======elapsedTime======', elapsedTime);
  const precision = 10000;
  const portion = elapsedTime.gt(duration) ? 1 : elapsedTime.mul(precision).div(duration);
  priceDiff = priceDiff.mul(portion).div(precision);
  let currentPrice = BigNumber.from(0);
  if (startPrice.gt(endPrice)) {
    currentPrice = startPrice.sub(priceDiff);
  } else {
    currentPrice = startPrice.add(priceDiff);
  }
  return currentPrice;
};

// Orderbook orders
export async function prepareOBOrder(
  user: User,
  chainId: BigNumberish,
  signer: JsonRpcSigner,
  order: Partial<OBOrder>,
  infinityExchange: Contract,
  infinityFeeTreasuryAddress: string
): Promise<ChainOBOrder | undefined> {
  // check if order is still valid
  const validOrder = await isOrderValid(user, order, infinityExchange, signer);
  if (!validOrder) {
    return undefined;
  }

  // grant approvals
  const approvals = await grantApprovals(user, order, signer, infinityExchange.address, infinityFeeTreasuryAddress);
  if (!approvals) {
    return undefined;
  }

  // sign order
  const chainOBOrder = await signOBOrder(chainId, infinityExchange.address, order, signer);

  console.log('Verifying signature');
  const isSigValid = await infinityExchange.verifyOrderSig(chainOBOrder);
  if (!isSigValid) {
    console.error('Signature is invalid');
    return undefined;
  } else {
    console.log('Signature is valid');
  }
  return chainOBOrder;
}

export async function isOrderValid(
  user: User,
  order: Partial<OBOrder>,
  infinityExchange: Contract,
  signer: JsonRpcSigner
): Promise<boolean> {
  // check timestamps
  const startTime = BigNumber.from(order.startTimeMs);
  const endTime = BigNumber.from(order.endTimeMs);
  const now = BigNumber.from(Date.now());
  if (now.gt(endTime)) {
    console.error('Order timestamps are not valid');
    return false;
  }

  // check if nonce is valid
  const isNonceValid = await infinityExchange.isNonceValid(user.address, order.nonce);
  console.log('Nonce valid:', isNonceValid);
  if (!isNonceValid) {
    console.error('Order nonce is not valid');
    return false;
  }

  // check on chain ownership
  if (order.isSellOrder) {
    const isCurrentOwner = await checkOnChainOwnership(user, order, signer);
    if (!isCurrentOwner) {
      return false;
    }
  }

  // default
  return true;
}

export async function grantApprovals(
  user: User,
  order: Partial<OBOrder>,
  signer: JsonRpcSigner,
  exchange: string,
  infinityFeeTreasuryAddress: string
): Promise<boolean> {
  try {
    console.log('Granting approvals');
    if (!order.isSellOrder) {
      // approve currencies
      const currentPrice = getCurrentOrderPrice(order);
      await approveERC20(
        user.address,
        order.execParams.currencyAddress,
        currentPrice,
        signer,
        infinityFeeTreasuryAddress
      );
    } else {
      // approve collections
      await approveERC721(user.address, order.nfts, signer, exchange);
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function approveERC20(
  user: string,
  currencyAddress: string,
  price: BigNumberish,
  signer: JsonRpcSigner,
  infinityFeeTreasuryAddress: string
) {
  try {
    console.log('Granting ERC20 approval');
    if (currencyAddress !== NULL_ADDRESS) {
      const contract = new Contract(currencyAddress, erc20Abi, signer);
      const allowance = BigNumber.from(await contract.allowance(user, infinityFeeTreasuryAddress));
      if (allowance.lt(price)) {
        await contract.approve(infinityFeeTreasuryAddress, constants.MaxUint256);
      } else {
        console.log('ERC20 approval already granted');
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.error('failed granting erc20 approvals');
    throw new Error(e);
  }
}

export async function approveERC721(user: string, items: OBOrderItem[], signer: JsonRpcSigner, exchange: string) {
  try {
    console.log('Granting ERC721 approval');
    for (const item of items) {
      const collection = item.collectionAddress;
      const contract = new Contract(collection, erc721Abi, signer);
      const isApprovedForAll = await contract.isApprovedForAll(user, exchange);
      if (!isApprovedForAll) {
        await contract.setApprovalForAll(exchange, true);
      } else {
        console.log('Already approved for all');
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.error('failed granting erc721 approvals');
    throw new Error(e);
  }
}

export async function checkOnChainOwnership(user: User, order: Partial<OBOrder>, signer: JsonRpcSigner): Promise<boolean> {
  console.log('Checking on chain ownership');
  let result = true;
  for (const nft of order.nfts) {
    const collection = nft.collectionAddress;
    const contract = new Contract(collection, erc721Abi, signer);
    for (const token of nft.tokens) {
      result = result && (await checkERC721Ownership(user, contract, token.tokenId));
    }
  }
  return result;
}

export async function checkERC721Ownership(user: User, contract: Contract, tokenId: BigNumberish): Promise<boolean> {
  try {
    console.log('Checking ERC721 on chain ownership');
    const owner = trimLowerCase(await contract.ownerOf(tokenId));
    if (owner !== trimLowerCase(user.address)) {
      // todo: should continue to check if other nfts are owned
      console.error('Order on chain ownership check failed');
      return false;
    }
  } catch (e) {
    console.error('Failed on chain ownership check; is collection ERC721 ?', e);
    return false;
  }
  return true;
}

export async function signOBOrder(
  chainId: BigNumberish,
  contractAddress: string,
  order: Partial<OBOrder>,
  signer: JsonRpcSigner
): Promise<ChainOBOrder | undefined> {
  const domain = {
    name: 'InfinityExchange',
    version: '1',
    chainId: chainId,
    verifyingContract: contractAddress
  };

  const types = {
    Order: [
      { name: 'isSellOrder', type: 'bool' },
      { name: 'signer', type: 'address' },
      { name: 'constraints', type: 'uint256[]' },
      { name: 'nfts', type: 'OrderItem[]' },
      { name: 'execParams', type: 'address[]' },
      { name: 'extraParams', type: 'bytes' }
    ],
    OrderItem: [
      { name: 'collection', type: 'address' },
      { name: 'tokens', type: 'TokenInfo[]' }
    ],
    TokenInfo: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'numTokens', type: 'uint256' }
    ]
  };

  // _getCalculatedDigest(chainId, contractAddress, order);

  const constraints = [
    order.numItems,
    order.startPriceWei,
    order.endPriceWei,
    Math.floor(order.startTimeMs / 1000),
    Math.floor(order.endTimeMs / 1000),
    order.minBpsToSeller,
    order.nonce
  ];

  const nfts = [];
  for (const nft of order.nfts) {
    const collection = nft.collectionAddress;
    const tokens = [];
    for (const token of nft.tokens) {
      tokens.push({
        tokenId: token.tokenId,
        numTokens: token.numTokens
      });
    }
    nfts.push({
      collection,
      tokens
    });
  }

  const execParams = [order.execParams.complicationAddress, order.execParams.currencyAddress];
  const extraParams = defaultAbiCoder.encode(['address'], [order.extraParams.buyer ?? NULL_ADDRESS]);

  const orderToSign = {
    isSellOrder: order.isSellOrder,
    signer: order.makerAddress,
    constraints,
    nfts,
    execParams,
    extraParams
  };

  // _printTypeEncodedData(domain, types, orderToSign);

  // sign order
  try {
    console.log('Signing order', orderToSign);
    const sig = await signer._signTypedData(domain, types, orderToSign);
    const splitSig = splitSignature(sig ?? '');
    const encodedSig = defaultAbiCoder.encode(['bytes32', 'bytes32', 'uint8'], [splitSig.r, splitSig.s, splitSig.v]);
    const signedOrder: ChainOBOrder = { ...orderToSign, sig: encodedSig };
    return signedOrder;
  } catch (e) {
    console.error('Error signing order', e);
  }
}

export async function signFormattedOrder(
  chainId: BigNumberish,
  contractAddress: string,
  order: ChainOBOrder,
  signer: JsonRpcSigner
): Promise<string> {
  const domain = {
    name: 'InfinityExchange',
    version: '1',
    chainId: chainId,
    verifyingContract: contractAddress
  };

  const types = {
    Order: [
      { name: 'isSellOrder', type: 'bool' },
      { name: 'signer', type: 'address' },
      { name: 'constraints', type: 'uint256[]' },
      { name: 'nfts', type: 'OrderItem[]' },
      { name: 'execParams', type: 'address[]' },
      { name: 'extraParams', type: 'bytes' }
    ],
    OrderItem: [
      { name: 'collection', type: 'address' },
      { name: 'tokens', type: 'TokenInfo[]' }
    ],
    TokenInfo: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'numTokens', type: 'uint256' }
    ]
  };

  // remove sig
  const orderToSign = {
    isSellOrder: order.isSellOrder,
    signer: order.signer,
    constraints: order.constraints,
    nfts: order.nfts,
    execParams: order.execParams,
    extraParams: order.extraParams
  };

  // sign order
  try {
    console.log('Signing order');
    const sig = await signer._signTypedData(domain, types, orderToSign);
    const splitSig = splitSignature(sig ?? '');
    // console.log('splitSig', splitSig);
    const encodedSig = defaultAbiCoder.encode(['bytes32', 'bytes32', 'uint8'], [splitSig.r, splitSig.s, splitSig.v]);
    return encodedSig;
  } catch (e) {
    console.error('Error signing order', e);
  }

  return '';
}

// ================================= Below functions are for reference & testing only =====================================
// ================================= Below functions are for reference & testing only =====================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _getCalculatedDigest(chainId: BigNumberish, exchangeAddr: string, order: OBOrder): BytesLike {
  const fnSign =
    'Order(bool isSellOrder,address signer,uint256[] constraints,OrderItem[] nfts,address[] execParams,bytes extraParams)OrderItem(address collection,TokenInfo[] tokens)TokenInfo(uint256 tokenId,uint256 numTokens)';
  const orderTypeHash = solidityKeccak256(['string'], [fnSign]);
  console.log('Order type hash', orderTypeHash);

  const constraints = [
    order.numItems,
    order.startPriceWei,
    order.endPriceWei,
    Math.floor(order.startTimeMs / 1000),
    Math.floor(order.endTimeMs / 1000),
    order.minBpsToSeller,
    order.nonce
  ];

  const nfts = [];
  for (const nft of order.nfts) {
    const collection = nft.collectionAddress;
    const tokens = [];
    for (const token of nft.tokens) {
      tokens.push({
        tokenId: token.tokenId,
        numTokens: token.numTokens
      });
    }
    nfts.push({
      collection,
      tokens
    });
  }

  const execParams = [order.execParams.complicationAddress, order.execParams.currencyAddress];
  const extraParams = defaultAbiCoder.encode(['address'], [order.extraParams.buyer ?? NULL_ADDRESS]);

  const constraintsHash = keccak256(
    defaultAbiCoder.encode(['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], constraints)
  );
  console.log('constraints hash', constraintsHash);
  const nftsHash = _getNftsHash(nfts);
  const execParamsHash = keccak256(defaultAbiCoder.encode(['address', 'address'], execParams));
  console.log('execParamsHash', execParamsHash);

  const calcEncode = defaultAbiCoder.encode(
    ['bytes32', 'bool', 'address', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [
      orderTypeHash,
      order.isSellOrder,
      order.makerAddress,
      constraintsHash,
      nftsHash,
      execParamsHash,
      keccak256(extraParams)
    ]
  );
  // console.log('Calculated encode', calcEncode);
  const orderHash = keccak256(calcEncode);

  // console.log('calculated orderHash', orderHash);
  const digest = _getDigest(chainId, exchangeAddr, orderHash);
  console.log('calculated digest', digest);
  return digest;
}

function _getNftsHash(nfts: OBOrderItem[]): BytesLike {
  const fnSign = 'OrderItem(address collection,TokenInfo[] tokens)TokenInfo(uint256 tokenId,uint256 numTokens)';
  const typeHash = solidityKeccak256(['string'], [fnSign]);
  console.log('Order item type hash', typeHash);

  const hashes = [];
  for (const nft of nfts) {
    const hash = keccak256(
      defaultAbiCoder.encode(['bytes32', 'uint256', 'bytes32'], [typeHash, nft.collectionAddress, _getTokensHash(nft.tokens)])
    );
    hashes.push(hash);
  }
  const encodeTypeArray = hashes.map((hash) => 'bytes32');
  const nftsHash = keccak256(defaultAbiCoder.encode(encodeTypeArray, hashes));
  console.log('nftsHash', nftsHash);
  return nftsHash;
}

function _getTokensHash(tokens: OBTokenInfo[]): BytesLike {
  const fnSign = 'TokenInfo(uint256 tokenId,uint256 numTokens)';
  const typeHash = solidityKeccak256(['string'], [fnSign]);
  console.log('Token info type hash', typeHash);

  const hashes = [];
  for (const token of tokens) {
    const hash = keccak256(
      defaultAbiCoder.encode(['bytes32', 'uint256', 'uint256'], [typeHash, token.tokenId, token.numTokens])
    );
    hashes.push(hash);
  }
  const encodeTypeArray = hashes.map((hash) => 'bytes32');
  const tokensHash = keccak256(defaultAbiCoder.encode(encodeTypeArray, hashes));
  console.log('tokensHash', tokensHash);
  return tokensHash;
}

function _getDigest(chainId: BigNumberish, exchangeAddr: BytesLike | string, orderHash: string | BytesLike): BytesLike {
  const domainSeparator = _getDomainSeparator(chainId, exchangeAddr);
  return solidityKeccak256(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, orderHash]);
}

function _getDomainSeparator(chainId: BigNumberish, exchangeAddr: BytesLike): BytesLike {
  const domainSeparator = keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        solidityKeccak256(
          ['string'],
          ['EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)']
        ),
        solidityKeccak256(['string'], ['InfinityExchange']),
        solidityKeccak256(['string'], ['1']), // for versionId = 1
        chainId,
        exchangeAddr
      ]
    )
  );
  console.log('domainSeparator:', domainSeparator);
  return domainSeparator;
}

function _printTypeEncodedData(domain: any, types: any, orderToSign: any) {
  console.log('===========================================================');
  const domainSeparator = _TypedDataEncoder.hashDomain(domain);
  const typedDataEncoder = _TypedDataEncoder.from(types);
  const primaryType = typedDataEncoder.primaryType;
  const primary = typedDataEncoder.encodeType(primaryType);
  const hashedType = solidityKeccak256(['string'], [primary]);
  // console.log('print primary type:', primaryType);
  console.log('print type hash:', hashedType);
  console.log('print domain separator:', domainSeparator);
  // console.log('order to sign', orderToSign);
  // const payload = _TypedDataEncoder.getPayload(domain, types, orderToSign);
  // console.log('print payload:', payload);
  // const encodedData = typedDataEncoder.encode(orderToSign);
  // const hashedEncoded = typedDataEncoder.hash(orderToSign);
  // console.log('print encoded typed data:', encodedData);
  // console.log('print typed data hash:', hashedEncoded);

  const orderDigest = _TypedDataEncoder.hash(domain, types, orderToSign);
  console.log('print typed data digest', orderDigest);
}
