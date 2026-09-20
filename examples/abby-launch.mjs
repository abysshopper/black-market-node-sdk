// Reconstruct the successful Abby the Vampire Squid launch on Robinhood Chain.
// Historical example only: it never signs, simulates, or broadcasts a transaction.
// Source: https://robinhoodchain.blockscout.com/tx/0xd0dcae27e9ec2f7fb6e2304d7b1d739fd2f45f91d1eb5e762cdfcf01819fb837

import assert from "node:assert/strict";
import {
  ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
  AUCTION_SUPPLY,
  AbyssPoolProfile,
  DUAL_DIVIDENDS_TEMPLATE_ID,
  TokenKind,
  buildAtomicLaunchCalldata,
  getAddresses,
} from "../dist/index.js";

export const ABBY_DEPLOYMENT = Object.freeze({
  chainId: 4663,
  transactionHash: "0xd0dcae27e9ec2f7fb6e2304d7b1d739fd2f45f91d1eb5e762cdfcf01819fb837",
  blockNumber: 56_232_272n,
  creator: "0x73bD52A3848B9219C6FE7E0D81CecF85E0c6D38b",
  launchFactory: "0xAf3FdC499b3717EBE8aD51B66bA78Cb083552351",
  launchFee: 500_000_000_000_000n,
  token: "0x450b50d216088e40cdd412da98b3b4c07bb4931f",
  pool: "0x5304f1300384d129d7f18a2b657d9cc6ff2cc002",
  pairedToken: "0x15f3385625D7e364C5a6216FBbceadf10fa90e7d",
  rewards: "0x26C8F60D2877AA9e7078f6701137c829A46eA882",
  splitter: "0x43b4b4aC6965FbDB641394664AC6a4e4bE43E0C2",
  feeClaimer: "0x17b6d871A96A683916129c27d63136AF7aDA842a",
  tokenId: 29n,
  initialBuyLaunchedTokenAmount: 913_888_003_035_081_430_019n,
});

export const abbyRequest = Object.freeze({
  creator: ABBY_DEPLOYMENT.creator,
  templateId: DUAL_DIVIDENDS_TEMPLATE_ID,
  templateVersion: 1,
  token: {
    kind: TokenKind.HolderDividend,
    name: "Abby the Vampire Squid",
    symbol: "ABBY",
    decimals: 18,
    supply: AUCTION_SUPPLY,
  },
  pool: {
    pairedToken: ABBY_DEPLOYMENT.pairedToken,
    launchedTokenIsQuote: false,
    profile: AbyssPoolProfile.StandardOracle,
    fee: 10_000,
    oracleConfigId: ATOMIC_LAUNCH_ORACLE_CONFIG_ID,
    launchTick: -800,
    liquidity: 1_040_808_692_711_685_547_298_718_484n,
    launchedTokenAmountMaximum: AUCTION_SUPPLY,
    pairedTokenAmountMaximum: 0n,
  },
  initialBuy: {
    pairedTokenAmountIn: 1_000n * 10n ** 18n,
    launchedTokenAmountOutMinimum: 909_318_563_019_906_022_868n,
    sqrtPriceLimitX96: 75_931_191_248_180_498_334_338_978_414n,
  },
  launchedTokenFees: { ownerBps: 0, rewardsBps: 10_000, burnBps: 0 },
  pairedTokenFees: { ownerBps: 0, rewardsBps: 10_000, burnBps: 0 },
  deadline: 1_788_724_575n,
});

export const abbyCalldata = buildAtomicLaunchCalldata(abbyRequest);
assert.equal(abbyCalldata.slice(0, 10), "0xe5ac002e");
assert.equal(abbyCalldata.length, 2_122);

console.log("Abby launch reconstructed:");
console.log("  transaction:", ABBY_DEPLOYMENT.transactionHash);
console.log("  token:      ", ABBY_DEPLOYMENT.token);
console.log("  pool:       ", ABBY_DEPLOYMENT.pool);
console.log("  calldata:   ", abbyCalldata.slice(0, 42), `… (${(abbyCalldata.length - 2) / 2} bytes)`);
