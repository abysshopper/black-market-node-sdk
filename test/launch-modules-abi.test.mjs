import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, toEventSelector } from "viem";
import {
  atomicLaunchFactoryAbi,
  holderDividendTrackerAbi,
  holderDividendTokenAbi,
  launchFeeOwnerRegistryAbi,
  launchFeeSplitterAbi,
  lockedFeeClaimerAbi,
  stakingRewardVaultAbi,
} from "../dist/index.js";

// Pinned selectors computed independently from the canonical Solidity signatures
// (contracts/src/launch/*.sol) and cross-checked against the compiled artifacts in
// contracts/out/<Contract>.sol/<Contract>.json `methodIdentifiers` — never derived
// from the ABIs under test.
const PINNED_SELECTORS = {
  "claimAndDistribute()": "0xdfb89c37",
  "distribute(address)": "0x63453ae1",
  "claimOwnerFees(address,address)": "0xb044ea9b",
  "claimableOwnerFees(address,address)": "0x897559f9",
  "stake(uint256)": "0xa694fc3a",
  "withdraw(uint256)": "0x2e1a7d4d",
  "claim()": "0x4e71d92d",
  "claimFor(address)": "0xddeae033",
  "earned(address)": "0x008cc262",
  "earned(address,address)": "0x211dc32d",
  "feeOwner(address)": "0x9c44d63b",
  "feeSplitter(address)": "0x4576e12f",
};

// keccak256("LaunchModulesDeployed(address,address,address,address)")
const LAUNCH_MODULES_DEPLOYED_TOPIC =
  "0x2e8a547484efbd2c794fa6b439cd58e315ee74d340bacd6f153858b9c177e2a0";

const account = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";

function functionItem(abi, name, inputCount) {
  const item = abi.find(
    (candidate) =>
      candidate.type === "function" &&
      candidate.name === name &&
      (inputCount === undefined || candidate.inputs.length === inputCount),
  );
  assert.ok(item, `missing ${name}/${inputCount ?? "*"}`);
  return item;
}

function assertPinnedEncoding(abi, name, args, inputCount) {
  const item = functionItem(abi, name, inputCount);
  const signature = `${name}(${item.inputs.map((input) => input.type).join(",")})`;
  const pinned = PINNED_SELECTORS[signature];
  assert.ok(pinned, `no pinned selector for ${signature}`);
  assert.equal(
    encodeFunctionData({ abi: [item], functionName: name, args }).slice(0, 10),
    pinned,
    `${signature} selector mismatch`,
  );
}

test("lockedFeeClaimerAbi encodes claimAndDistribute() to the pinned selector", () => {
  assertPinnedEncoding(lockedFeeClaimerAbi, "claimAndDistribute", [], 0);
});

test("launchFeeSplitterAbi encodes distribute and owner-claim surface to pinned selectors", () => {
  assertPinnedEncoding(launchFeeSplitterAbi, "distribute", [token], 1);
  assertPinnedEncoding(launchFeeSplitterAbi, "claimOwnerFees", [token, recipient], 2);
  assertPinnedEncoding(launchFeeSplitterAbi, "claimableOwnerFees", [account, token], 2);
});

test("stakingRewardVaultAbi encodes stake/withdraw and the StreamedRewards claim surface", () => {
  assertPinnedEncoding(stakingRewardVaultAbi, "stake", [1n], 1);
  assertPinnedEncoding(stakingRewardVaultAbi, "withdraw", [1n], 1);
  assertPinnedEncoding(stakingRewardVaultAbi, "claim", [], 0);
  assertPinnedEncoding(stakingRewardVaultAbi, "claimFor", [recipient], 1);
});

test("stakingRewardVaultAbi carries both earned overloads with pinned selectors", () => {
  assertPinnedEncoding(stakingRewardVaultAbi, "earned", [account], 1);
  assertPinnedEncoding(stakingRewardVaultAbi, "earned", [account, token], 2);
});

test("holderDividendTrackerAbi shares the StreamedRewards surface and adds eligibility reads", () => {
  assertPinnedEncoding(holderDividendTrackerAbi, "claim", [], 0);
  assertPinnedEncoding(holderDividendTrackerAbi, "claimFor", [recipient], 1);
  assertPinnedEncoding(holderDividendTrackerAbi, "earned", [account], 1);
  assertPinnedEncoding(holderDividendTrackerAbi, "earned", [account, token], 2);
  for (const name of [
    "eligibleBalanceOf",
    "eligibleSupply",
    "isExcluded",
    "trackedToken",
    "protocolAdmin",
  ]) {
    functionItem(holderDividendTrackerAbi, name);
  }
});

test("holderDividendTokenAbi exposes rewardTracker and RewardTrackerConfigured", () => {
  functionItem(holderDividendTokenAbi, "rewardTracker", 0);
  const event = holderDividendTokenAbi.find(
    (candidate) => candidate.type === "event" && candidate.name === "RewardTrackerConfigured",
  );
  assert.ok(event, "missing RewardTrackerConfigured event");
  assert.deepEqual(
    event.inputs.map((input) => [input.name, input.type, input.indexed]),
    [["tracker", "address", true]],
  );
});

test("launchFeeOwnerRegistryAbi encodes feeOwner and feeSplitter to pinned selectors", () => {
  assertPinnedEncoding(launchFeeOwnerRegistryAbi, "feeOwner", [token], 1);
  assertPinnedEncoding(launchFeeOwnerRegistryAbi, "feeSplitter", [token], 1);
});

test("atomicLaunchFactoryAbi LaunchModulesDeployed event matches the pinned topic", () => {
  const event = atomicLaunchFactoryAbi.find(
    (candidate) => candidate.type === "event" && candidate.name === "LaunchModulesDeployed",
  );
  assert.ok(event, "missing LaunchModulesDeployed event");
  assert.equal(toEventSelector(event), LAUNCH_MODULES_DEPLOYED_TOPIC);
});

test("splitter policy getters return the named Disposition tuple components", () => {
  for (const name of ["token0Policy", "token1Policy"]) {
    const item = functionItem(launchFeeSplitterAbi, name, 0);
    assert.equal(item.outputs[0].type, "tuple");
    assert.deepEqual(
      item.outputs[0].components.map((component) => [component.name, component.type]),
      [
        ["ownerBps", "uint16"],
        ["rewardsBps", "uint16"],
        ["burnBps", "uint16"],
      ],
    );
  }
});

test("rewardData returns the eight named RewardData struct fields", () => {
  for (const abi of [stakingRewardVaultAbi, holderDividendTrackerAbi]) {
    const item = functionItem(abi, "rewardData", 1);
    assert.deepEqual(
      item.outputs.map((output) => [output.name, output.type]),
      [
        ["periodFinish", "uint256"],
        ["rewardRate", "uint256"],
        ["lastUpdateTime", "uint256"],
        ["rewardPerTokenStored", "uint256"],
        ["rewardPerTokenRemainder", "uint256"],
        ["remainingRewards", "uint256"],
        ["queuedRewards", "uint256"],
        ["accountedBalance", "uint256"],
      ],
    );
  }
});
