import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toBytes,
  toFunctionSelector,
} from "viem";
import {
  abyssFactoryAbi,
  abyssFixedSupplyTokenAbi,
  abyssLaunchCoordinatorAbi,
  abyssPoolAbi,
  abyssPositionLockerAbi,
  abyssPositionManagerAbi,
  abyssRouterAbi,
  burnableFixedSupplyTokenAbi,
  launchTokenBurnSinkAbi,
  launchTokenFactoryAbi,
  TokenKind,
} from "../dist/index.js";

const token0 = "0x1111111111111111111111111111111111111111";
const token1 = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const pool = "0x6666666666666666666666666666666666666666";
const positionManager = "0x4444444444444444444444444444444444444444";
const locker = "0x5555555555555555555555555555555555555555";
const oracleConfigId = `0x${"ab".repeat(32)}`;

const key = {
  token0,
  token1,
  profile: 1,
  fee: 3_000,
  quoteIsToken0: false,
  oracleConfigId,
};

const poolKeyComponents = [
  ["token0", "address"],
  ["token1", "address"],
  ["profile", "uint8"],
  ["fee", "uint24"],
  ["quoteIsToken0", "bool"],
  ["oracleConfigId", "bytes32"],
];

const lockComponents = [
  { name: "owner", type: "address" },
  { name: "claimAuthority", type: "address" },
  { name: "feeRecipient", type: "address" },
  { name: "unlockTime", type: "uint64" },
  { name: "permissionlessClaim", type: "bool" },
];

function sourceSelector(signature) {
  return keccak256(toBytes(signature)).slice(0, 10);
}

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

function assertSelector(abi, name, inputCount, sourceSignature) {
  assert.equal(
    toFunctionSelector(functionItem(abi, name, inputCount)),
    sourceSelector(sourceSignature),
  );
}

function assertPoolKeyTuple(abi, functionName) {
  const tuple = functionItem(abi, functionName).inputs[0];
  assert.equal(tuple.type, "tuple");
  assert.deepEqual(
    tuple.components.map(({ name, type }) => [name, type]),
    poolKeyComponents,
  );
}

test("launch ABIs preserve source selectors, PoolKey order, and ERC721 overloads", () => {
  assertPoolKeyTuple(abyssFactoryAbi, "computePoolId");
  assertPoolKeyTuple(abyssFactoryAbi, "computePoolAddress");
  assertPoolKeyTuple(abyssPositionManagerAbi, "createAndInitializePoolIfNecessary");
  assertPoolKeyTuple(abyssRouterAbi, "exactInputSingle");

  assert.deepEqual(
    functionItem(abyssPositionManagerAbi, "positions").outputs.map(({ name, type }) => [
      name,
      type,
    ]),
    [
      ["account", "address"],
      ["pool", "address"],
      ["tickLower", "int24"],
      ["tickUpper", "int24"],
      ["liquidity", "uint128"],
    ],
  );
  assert.deepEqual(
    functionItem(abyssPositionLockerAbi, "locks").outputs.map(({ name, type }) => [name, type]),
    lockComponents.map(({ name, type }) => [name, type]),
  );
  assert.deepEqual(
    functionItem(abyssPoolAbi, "slot0").outputs.map(({ name, type }) => [name, type]),
    [
      ["sqrtPriceX96", "uint160"],
      ["tick", "int24"],
      ["observationIndex", "uint16"],
      ["observationCardinality", "uint16"],
      ["observationCardinalityNext", "uint16"],
      ["feeProtocol", "uint8"],
      ["unlocked", "bool"],
    ],
  );

  assertSelector(abyssFactoryAbi, "feeAmountTickSpacing", 1, "feeAmountTickSpacing(uint24)");
  assertSelector(abyssFactoryAbi, "oracleConfigs", 1, "oracleConfigs(bytes32)");
  assertSelector(abyssFactoryAbi, "getPool", 1, "getPool(bytes32)");
  assertSelector(abyssFactoryAbi, "isPool", 1, "isPool(address)");

  assertSelector(
    abyssFactoryAbi,
    "computePoolId",
    1,
    "computePoolId((address,address,uint8,uint24,bool,bytes32))",
  );
  assertSelector(
    abyssFactoryAbi,
    "computePoolAddress",
    1,
    "computePoolAddress((address,address,uint8,uint24,bool,bytes32))",
  );
  assertSelector(abyssPositionManagerAbi, "factory", 0, "factory()");
  assertSelector(abyssPositionManagerAbi, "nextTokenId", 0, "nextTokenId()");
  assertSelector(abyssPositionManagerAbi, "positions", 1, "positions(uint256)");
  assertSelector(abyssPositionManagerAbi, "accountFor", 2, "accountFor(uint256,address)");
  assertSelector(
    abyssPositionManagerAbi,
    "createAndInitializePoolIfNecessary",
    4,
    "createAndInitializePoolIfNecessary((address,address,uint8,uint24,bool,bytes32),uint160,uint160,uint160)",
  );
  assertSelector(
    abyssPositionManagerAbi,
    "mint",
    8,
    "mint(address,address,int24,int24,uint128,uint256,uint256,uint256)",
  );
  assertSelector(abyssPositionManagerAbi, "multicall", 1, "multicall(bytes[])");
  assertSelector(
    abyssPositionManagerAbi,
    "safeTransferFrom",
    3,
    "safeTransferFrom(address,address,uint256)",
  );
  assertSelector(
    abyssPositionManagerAbi,
    "safeTransferFrom",
    4,
    "safeTransferFrom(address,address,uint256,bytes)",
  );
  assertSelector(abyssPositionLockerAbi, "locks", 1, "locks(uint256)");
  assertSelector(abyssPositionLockerAbi, "claim", 1, "claim(uint256)");
  assertSelector(abyssPositionLockerAbi, "positionManager", 0, "positionManager()");
  assertSelector(abyssPoolAbi, "slot0", 0, "slot0()");
  assertSelector(abyssPoolAbi, "observeTruncated", 1, "observeTruncated(uint32[])");
  assertSelector(abyssPoolAbi, "factory", 0, "factory()");
  assertSelector(abyssPoolAbi, "token0", 0, "token0()");
  assertSelector(abyssPoolAbi, "token1", 0, "token1()");
  assertSelector(abyssPoolAbi, "fee", 0, "fee()");
  assertSelector(abyssPoolAbi, "tickSpacing", 0, "tickSpacing()");
  assertSelector(abyssPoolAbi, "quoteIsToken0", 0, "quoteIsToken0()");
  assertSelector(abyssRouterAbi, "factory", 0, "factory()");
  assertSelector(
    abyssRouterAbi,
    "exactInputSingle",
    7,
    "exactInputSingle((address,address,uint8,uint24,bool,bytes32),address,bool,uint256,uint256,uint160,uint256)",
  );
});

test("create-init and mint calldata round-trip with the exact source argument order", () => {
  const createArgs = [
    key,
    79228162514264337593543950336n,
    79228162514264337593543950335n,
    79228162514264337593543950337n,
  ];
  const createData = encodeFunctionData({
    abi: abyssPositionManagerAbi,
    functionName: "createAndInitializePoolIfNecessary",
    args: createArgs,
  });
  const decodedCreate = decodeFunctionData({ abi: abyssPositionManagerAbi, data: createData });
  assert.equal(decodedCreate.functionName, "createAndInitializePoolIfNecessary");
  assert.deepEqual(decodedCreate.args, createArgs);

  const mintArgs = [pool, recipient, -120, 120, 500_000n, 700_000n, 800_000n, 1_800_000_000n];
  const mintData = encodeFunctionData({
    abi: abyssPositionManagerAbi,
    functionName: "mint",
    args: mintArgs,
  });
  const decodedMint = decodeFunctionData({ abi: abyssPositionManagerAbi, data: mintData });
  assert.equal(decodedMint.functionName, "mint");
  assert.deepEqual(decodedMint.args, mintArgs);
});

test("four-argument safe transfer carries exact locker Lock encoding", () => {
  const lock = {
    owner: recipient,
    claimAuthority: positionManager,
    feeRecipient: token1,
    unlockTime: 1_900_000_000n,
    permissionlessClaim: true,
  };
  const lockData = encodeAbiParameters(
    [{ name: "lock", type: "tuple", components: lockComponents }],
    [lock],
  );
  const transferArgs = [recipient, locker, 17n, lockData];
  const transferData = encodeFunctionData({
    abi: abyssPositionManagerAbi,
    functionName: "safeTransferFrom",
    args: transferArgs,
  });
  assert.equal(
    transferData.slice(0, 10),
    sourceSelector("safeTransferFrom(address,address,uint256,bytes)"),
  );
  const decodedTransfer = decodeFunctionData({ abi: abyssPositionManagerAbi, data: transferData });
  assert.equal(decodedTransfer.functionName, "safeTransferFrom");
  assert.deepEqual(decodedTransfer.args, transferArgs);
});

test("locker read calldata and flat public-mapping result round-trip", () => {
  const readData = encodeFunctionData({
    abi: abyssPositionLockerAbi,
    functionName: "locks",
    args: [17n],
  });
  const decodedRead = decodeFunctionData({ abi: abyssPositionLockerAbi, data: readData });
  assert.equal(decodedRead.functionName, "locks");
  assert.deepEqual(decodedRead.args, [17n]);

  const resultValues = [recipient, positionManager, token1, 1_900_000_000n, true];
  const resultData = encodeAbiParameters(lockComponents, resultValues);
  assert.deepEqual(
    decodeFunctionResult({
      abi: abyssPositionLockerAbi,
      functionName: "locks",
      data: resultData,
    }),
    resultValues,
  );
});

test("router exactInputSingle calldata round-trips source tuple and bounds", () => {
  const routerArgs = [key, recipient, true, 1_000_000n, 990_000n, 4295128740n, 1_800_000_000n];
  const data = encodeFunctionData({
    abi: abyssRouterAbi,
    functionName: "exactInputSingle",
    args: routerArgs,
  });
  assert.equal(
    data.slice(0, 10),
    sourceSelector(
      "exactInputSingle((address,address,uint8,uint24,bool,bytes32),address,bool,uint256,uint256,uint160,uint256)",
    ),
  );
  const decoded = decodeFunctionData({ abi: abyssRouterAbi, data });
  assert.equal(decoded.functionName, "exactInputSingle");
  assert.deepEqual(decoded.args, routerArgs);
});

test("launch token factory ABI exactly exposes entropy-bound deployment and authority", () => {
  assert.deepEqual(
    launchTokenFactoryAbi
      .filter(({ type }) => type === "error")
      .map(({ name, inputs }) => [name, inputs]),
    [
      ["EmptyName", []],
      ["EmptySymbol", []],
      ["ZeroSupply", []],
      ["ZeroCreator", []],
      ["Unauthorized", []],
      ["AlreadyConfigured", []],
      ["InvalidLauncher", []],
    ],
  );
  assertSelector(
    launchTokenFactoryAbi,
    "deploy",
    6,
    "deploy(address,uint8,string,string,uint8,uint256)",
  );
  assertSelector(
    launchTokenFactoryAbi,
    "computeDeploymentSalt",
    8,
    "computeDeploymentSalt(address,uint256,uint256,uint8,string,string,uint8,uint256)",
  );
  assertSelector(
    launchTokenFactoryAbi,
    "predictTokenAddress",
    8,
    "predictTokenAddress(address,uint256,uint256,uint8,string,string,uint8,uint256)",
  );
  assertSelector(launchTokenFactoryAbi, "DEPLOYMENT_SALT_DOMAIN", 0, "DEPLOYMENT_SALT_DOMAIN()");
  assertSelector(launchTokenFactoryAbi, "deploymentNonce", 0, "deploymentNonce()");
  assertSelector(launchTokenFactoryAbi, "launchAuthority", 1, "launchAuthority(address)");
  assertSelector(launchTokenFactoryAbi, "launcher", 0, "launcher()");
  assertSelector(launchTokenFactoryAbi, "setLauncher", 1, "setLauncher(address)");
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "deploy").inputs.map(({ name, type }) => [name, type]),
    [
      ["creator", "address"],
      ["kind", "uint8"],
      ["name", "string"],
      ["symbol", "string"],
      ["decimals", "uint8"],
      ["supply", "uint256"],
    ],
  );
  const provenanceInputs = [
    ["creator", "address"],
    ["nonce", "uint256"],
    ["prevrandao", "uint256"],
    ["kind", "uint8"],
    ["name", "string"],
    ["symbol", "string"],
    ["decimals", "uint8"],
    ["supply", "uint256"],
  ];
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "computeDeploymentSalt").inputs.map(({ name, type }) => [
      name,
      type,
    ]),
    provenanceInputs,
  );
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "predictTokenAddress").inputs.map(({ name, type }) => [
      name,
      type,
    ]),
    provenanceInputs,
  );
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "deploy").outputs.map(({ name, type }) => [name, type]),
    [["token", "address"]],
  );
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "computeDeploymentSalt").outputs.map(({ name, type }) => [
      name,
      type,
    ]),
    [["", "bytes32"]],
  );
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "predictTokenAddress").outputs.map(({ name, type }) => [
      name,
      type,
    ]),
    [["token", "address"]],
  );
  assert.deepEqual(
    functionItem(launchTokenFactoryAbi, "launchAuthority").outputs.map(({ name, type }) => [
      name,
      type,
    ]),
    [["authority", "address"]],
  );
  const event = launchTokenFactoryAbi.find(
    ({ type, name }) => type === "event" && name === "TokenDeployed",
  );
  assert.ok(event);
  assert.deepEqual(
    event.inputs.map(({ name, type, indexed }) => [name, type, indexed]),
    [
      ["token", "address", true],
      ["creator", "address", true],
      ["salt", "bytes32", true],
      ["kind", "uint8", false],
      ["nonce", "uint256", false],
      ["prevrandao", "uint256", false],
    ],
  );

  assert.deepEqual([TokenKind.Burnable, TokenKind.HolderDividend], [0, 1]);
  assert.equal("Fixed" in TokenKind, false);

  for (const kind of [TokenKind.Burnable, TokenKind.HolderDividend]) {
    const deployArgs = [recipient, kind, "Launch Token", "LT", 18, 1_000_000n];
    const deployData = encodeFunctionData({
      abi: launchTokenFactoryAbi,
      functionName: "deploy",
      args: deployArgs,
    });
    const deployDecoded = decodeFunctionData({ abi: launchTokenFactoryAbi, data: deployData });
    assert.equal(deployDecoded.functionName, "deploy");
    assert.deepEqual(deployDecoded.args, deployArgs);

    const provenanceArgs = [
      recipient,
      7n,
      42n,
      kind,
      "Launch Token",
      "LT",
      18,
      1_000_000n,
    ];
    for (const functionName of ["computeDeploymentSalt", "predictTokenAddress"]) {
      const data = encodeFunctionData({
        abi: launchTokenFactoryAbi,
        functionName,
        args: provenanceArgs,
      });
      const decoded = decodeFunctionData({ abi: launchTokenFactoryAbi, data });
      assert.equal(decoded.functionName, functionName);
      assert.deepEqual(decoded.args, provenanceArgs);
    }
  }
});

test("launch token burn sink ABI exactly exposes immutable binding and permissionless burn", () => {
  assert.deepEqual(
    launchTokenBurnSinkAbi.map(({ type, name }) => [type, name ?? null]),
    [
      ["constructor", null],
      ["error", "BurnAccountingMismatch"],
      ["error", "BurnFailed"],
      ["error", "InvalidToken"],
      ["error", "Reentrancy"],
      ["error", "ZeroBalance"],
      ["event", "Burned"],
      ["function", "burn"],
      ["function", "token"],
    ],
  );
  const constructorItem = launchTokenBurnSinkAbi.find(({ type }) => type === "constructor");
  assert.deepEqual(
    constructorItem.inputs.map(({ name, type }) => [name, type]),
    [["token_", "address"]],
  );
  assert.deepEqual(
    launchTokenBurnSinkAbi
      .filter(({ type }) => type === "error")
      .map(({ name, inputs }) => [
        name,
        inputs.map(({ name: inputName, type }) => [inputName, type]),
      ]),
    [
      [
        "BurnAccountingMismatch",
        [
          ["balanceBefore", "uint256"],
          ["balanceAfter", "uint256"],
          ["supplyBefore", "uint256"],
          ["supplyAfter", "uint256"],
        ],
      ],
      ["BurnFailed", []],
      ["InvalidToken", [["token", "address"]]],
      ["Reentrancy", []],
      ["ZeroBalance", []],
    ],
  );
  const event = launchTokenBurnSinkAbi.find(
    ({ type, name }) => type === "event" && name === "Burned",
  );
  assert.deepEqual(
    event.inputs.map(({ name, type, indexed }) => [name, type, indexed]),
    [
      ["caller", "address", true],
      ["amount", "uint256", false],
    ],
  );
  assert.equal(event.anonymous, false);
  assertSelector(launchTokenBurnSinkAbi, "burn", 0, "burn()");
  assertSelector(launchTokenBurnSinkAbi, "token", 0, "token()");
  assert.deepEqual(
    functionItem(launchTokenBurnSinkAbi, "burn").outputs.map(({ name, type }) => [name, type]),
    [["amount", "uint256"]],
  );
  assert.deepEqual(
    functionItem(launchTokenBurnSinkAbi, "token").outputs.map(({ name, type }) => [name, type]),
    [["", "address"]],
  );
  const data = encodeFunctionData({ abi: launchTokenBurnSinkAbi, functionName: "burn" });
  const decoded = decodeFunctionData({ abi: launchTokenBurnSinkAbi, data });
  assert.equal(decoded.functionName, "burn");
  assert.deepEqual(decoded.args ?? [], []);
});

test("launch coordinator ABI binds the immutable token factory", () => {
  const constructorItem = abyssLaunchCoordinatorAbi.find(({ type }) => type === "constructor");
  assert.ok(constructorItem);
  assert.deepEqual(
    constructorItem.inputs.map(({ name, type }) => [name, type]),
    [
      ["factory_", "address"],
      ["positionManager_", "address"],
      ["positionLocker_", "address"],
      ["tokenFactory_", "address"],
    ],
  );
  assertSelector(abyssLaunchCoordinatorAbi, "tokenFactory", 0, "tokenFactory()");
});

test("fixed and burnable token ABIs expose their exact configurable constructors", () => {
  const expectedConstructor = [
    ["name_", "string"],
    ["symbol_", "string"],
    ["decimals_", "uint8"],
    ["recipient", "address"],
    ["supply", "uint256"],
  ];
  for (const abi of [abyssFixedSupplyTokenAbi, burnableFixedSupplyTokenAbi]) {
    const constructorItem = abi.find(({ type }) => type === "constructor");
    assert.ok(constructorItem);
    assert.deepEqual(
      constructorItem.inputs.map(({ name, type }) => [name, type]),
      expectedConstructor,
    );
  }
  assertSelector(burnableFixedSupplyTokenAbi, "burn", 1, "burn(uint256)");
  assertSelector(burnableFixedSupplyTokenAbi, "burnFrom", 2, "burnFrom(address,uint256)");
});
