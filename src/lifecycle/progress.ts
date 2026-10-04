import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, stringToHex, toHex, zeroAddress, zeroHash, type Address, type Hash, type Hex } from "viem";
import { abyssLifecycleAdapterAbi, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleRegistryAbi, lifecycleV4CollectorFactoryAbi, lifecycleV4HookAbi, lifecycleV4LockerAbi, poolBoundLaunchFeeHookDeployerV1Abi, poolBoundLaunchFeeHookV1Abi, poolBoundV4LifecycleAdapterAbi, sharedV4LifecycleAdapterAbi } from "./abi.js";
import { decodePoolBoundV4LifecycleMarketConfig, encodePoolBoundHookParameters, hasLifecycleV4HookPermissions, hashPoolBoundV4MarketCommitment, poolBoundHookInitCodeHash, predictPoolBoundHookAddress, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA, V4_POOL_BOUND_LIFECYCLE_PROFILE_ID, type PoolBoundHookParametersV1 } from "./markets.js";
import { hashLaunchIdentity, hashLaunchPlan, launchProgressV1Components, LifecycleMode, LifecyclePhase, LifecycleVenue, LIFECYCLE_REQUIRED_CAPABILITIES, type AdapterRegistrationV1, type LaunchPlanV1, type LaunchProgressV1, type MarketIdentityV1, type MarketLiveStateV1, type PreparedMarketV1, type ProfileRegistrationV1, type ProfileTopologyV1 } from "./schema.js";
import { assertLifecycleBlock, lifecycleRpc, readLifecycleBlock, readLifecycleContract, readLifecycleProfileTopology, rpcHex, rpcObject, rpcQuantity } from "./rpc.js";
import { LifecyclePlanningError, type CanonicalLaunchProgress, type LifecycleBlock, type LifecycleMarketProgress, type LifecycleProfile, type LifecycleReceiptReference, type LifecycleReceiptStatus, type LifecycleRpcClient, type PoolBoundHookDeployment, type ReadLaunchProgressOptions } from "./types.js";

export const ABYSS_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint8,uint24,bytes32,uint160,(int24,int24,uint128,uint256)[])"));
export const V4_LIFECYCLE_PROFILE_ID = keccak256(stringToHex("black-market.v4-lifecycle-market.v3"));
export const V4_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,(int24,int24,uint128,bytes32,uint256)[])"));

export async function predictLifecycleToken(options: { client: LifecycleRpcClient; plan: LaunchPlanV1 }): Promise<Address> {
  const block = await readLifecycleBlock(options.client);
  const token = await readLifecycleContract<Address>(options.client, options.plan.orchestrator, launchLifecycleAbi, "predictToken", [options.plan], block);
  await assertLifecycleBlock(options.client, block);
  return token;
}

type BoundProfileGraph = { manager: Address; oracleFactory: Address; locker: Address; collectorFactory: Address; deployer: Address; creationCode: Hex };

async function readDependencyCode(client: LifecycleRpcClient, address: Address, block: LifecycleBlock): Promise<Hex> {
  const code = rpcHex(await lifecycleRpc(client, "eth_getCode", [address, toHex(block.number)]), "lifecycle dependency code");
  if (address === zeroAddress || code === "0x") throw new LifecyclePlanningError("PROFILE_DEPENDENCY", `Lifecycle dependency ${address} has no deployed code`);
  return code;
}

async function certifyLifecycleProfile(client: LifecycleRpcClient, orchestrator: Address, id: Hex, registration: ProfileRegistrationV1, adapter: AdapterRegistrationV1, recorded: ProfileTopologyV1 | undefined, block: LifecycleBlock, chainId: bigint): Promise<{ topology: ProfileTopologyV1; boundGraph?: BoundProfileGraph }> {
  const shared = id.toLowerCase() === V4_LIFECYCLE_PROFILE_ID.toLowerCase() && registration.configSchema.toLowerCase() === V4_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() && adapter.configVersion === 2;
  const bound = id.toLowerCase() === V4_POOL_BOUND_LIFECYCLE_PROFILE_ID.toLowerCase() && registration.configSchema.toLowerCase() === V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() && adapter.configVersion === 3;
  const abyss = registration.configSchema.toLowerCase() === ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() && adapter.configVersion === 1;
  if (!shared && !bound && !abyss) throw new LifecyclePlanningError("UNSUPPORTED_PROFILE", "Profile ID, schema and implementation config version are not an exact supported lifecycle offering");
  if (bound && recorded === undefined) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Pool-bound profiles require registry-certified topology; legacy registry fallback is only for exact known shared/Abyss profiles");
  const topology: ProfileTopologyV1 = recorded ?? { hookTopology: shared ? 1 : 0, configVersion: adapter.configVersion, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash };
  if (topology.hookTopology !== (shared ? 1 : bound ? 2 : 0) || topology.configVersion !== adapter.configVersion || (!bound && (topology.hookDeployer !== zeroAddress || topology.hookCreationCodeHash !== zeroHash))) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Certified topology does not match the exact profile/schema/version");
  const implementationCode = await readDependencyCode(client, adapter.implementation, block);
  if (keccak256(implementationCode).toLowerCase() !== adapter.codeHash.toLowerCase()) throw new LifecyclePlanningError("PROFILE_CODE_HASH", "Adapter code hash differs from immutable registry approval");
  const authority = await readLifecycleContract<Address>(client, adapter.implementation, lifecycleAdapterAbi, "core", [], block);
  const digest = await readLifecycleContract<Hex>(client, adapter.implementation, lifecycleAdapterAbi, "dependencyDigest", [], block);
  if (authority.toLowerCase() !== orchestrator.toLowerCase() || digest.toLowerCase() !== registration.dependencyDigest.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Adapter authority or dependency digest differs from immutable registry approval");
  if (abyss) {
    const factory = await readLifecycleContract<Address>(client, adapter.implementation, abyssLifecycleAdapterAbi, "factory", [], block);
    const schema = await readLifecycleContract<Hex>(client, adapter.implementation, abyssLifecycleAdapterAbi, "CONFIG_SCHEMA", [], block);
    const version = await readLifecycleContract<number>(client, adapter.implementation, abyssLifecycleAdapterAbi, "CONFIG_VERSION", [], block);
    const domain = keccak256(stringToHex("BLACK_MARKET_ABYSS_CANONICAL_PROFILE_V1"));
    const known = [0, 1, 2, 3].some((variant) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }], [domain, chainId, factory, variant])).toLowerCase() === id.toLowerCase());
    if (!known || schema.toLowerCase() !== ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() || version !== 1 || registration.factory.toLowerCase() !== factory.toLowerCase() || registration.venue.toLowerCase() !== factory.toLowerCase() || registration.hook !== zeroAddress) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Abyss profile is not the exact canonical factory/variant/schema binding");
    await readDependencyCode(client, factory, block);
    return { topology };
  }
  const abi = bound ? poolBoundV4LifecycleAdapterAbi : sharedV4LifecycleAdapterAbi;
  const profileId = await readLifecycleContract<Hex>(client, adapter.implementation, abi, "PROFILE_ID", [], block);
  const schema = await readLifecycleContract<Hex>(client, adapter.implementation, abi, "CONFIG_SCHEMA", [], block);
  const manager = await readLifecycleContract<Address>(client, adapter.implementation, abi, "poolManager", [], block);
  const locker = await readLifecycleContract<Address>(client, adapter.implementation, abi, "locker", [], block);
  const collectorFactory = await readLifecycleContract<Address>(client, adapter.implementation, abi, "collectorFactory", [], block);
  if (profileId.toLowerCase() !== id.toLowerCase() || schema.toLowerCase() !== registration.configSchema.toLowerCase() || registration.factory !== zeroAddress || registration.venue.toLowerCase() !== manager.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "V4 profile does not certify the adapter's exact venue and schema");
  const managerCode = await readDependencyCode(client, manager, block);
  const lockerCode = await readDependencyCode(client, locker, block);
  const collectorFactoryCode = await readDependencyCode(client, collectorFactory, block);
  const launcher = await readLifecycleContract<Address>(client, locker, lifecycleV4LockerAbi, "launcher", [], block);
  const lockerManager = await readLifecycleContract<Address>(client, locker, lifecycleV4LockerAbi, "poolManager", [], block);
  if (launcher.toLowerCase() !== adapter.implementation.toLowerCase() || lockerManager.toLowerCase() !== manager.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Locker does not bind this exact registrar and PoolManager");
  if (shared) {
    const root = await readLifecycleContract<Address>(client, adapter.implementation, sharedV4LifecycleAdapterAbi, "hookRoot", [], block);
    const rootCode = await readDependencyCode(client, root, block);
    const registrar = await readLifecycleContract<Address>(client, root, lifecycleV4HookAbi, "registrar", [], block);
    const rootManager = await readLifecycleContract<Address>(client, root, lifecycleV4HookAbi, "poolManager", [], block);
    const oracleFactory = await readLifecycleContract<Address>(client, root, lifecycleV4HookAbi, "oracleFactory", [], block);
    const oracleCode = await readDependencyCode(client, oracleFactory, block);
    const expectedDigest = keccak256(encodeAbiParameters([
      { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
      { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    ], [chainId, orchestrator, manager, keccak256(managerCode), root, keccak256(rootCode), oracleFactory, keccak256(oracleCode), locker, keccak256(lockerCode), collectorFactory, keccak256(collectorFactoryCode)]));
    if (!hasLifecycleV4HookPermissions(root) || registration.hook.toLowerCase() !== root.toLowerCase() || registrar.toLowerCase() !== adapter.implementation.toLowerCase() || rootManager.toLowerCase() !== manager.toLowerCase() || expectedDigest.toLowerCase() !== digest.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Shared V4 root and live immutable graph differ from profile certification");
    return { topology };
  }
  const version = await readLifecycleContract<number>(client, adapter.implementation, poolBoundV4LifecycleAdapterAbi, "CONFIG_VERSION", [], block);
  const oracleFactory = await readLifecycleContract<Address>(client, adapter.implementation, poolBoundV4LifecycleAdapterAbi, "oracleFactory", [], block);
  const deployer = await readLifecycleContract<Address>(client, adapter.implementation, poolBoundV4LifecycleAdapterAbi, "hookDeployer", [], block);
  const oracleCode = await readDependencyCode(client, oracleFactory, block);
  const deployerCode = await readDependencyCode(client, deployer, block);
  const coreCode = await readDependencyCode(client, orchestrator, block);
  const creationCodeHash = await readLifecycleContract<Hex>(client, deployer, poolBoundLaunchFeeHookDeployerV1Abi, "creationCodeHash", [], block);
  const chunk0 = await readLifecycleContract<Address>(client, deployer, poolBoundLaunchFeeHookDeployerV1Abi, "codeChunk0", [], block);
  const chunk1 = await readLifecycleContract<Address>(client, deployer, poolBoundLaunchFeeHookDeployerV1Abi, "codeChunk1", [], block);
  const chunk0Code = await readDependencyCode(client, chunk0, block);
  const chunk1Code = chunk1 === zeroAddress ? "0x" : await readDependencyCode(client, chunk1, block);
  if (chunk0 === chunk1 || !chunk0Code.startsWith("0x00") || chunk0Code.length <= 4 || (chunk0Code.length - 2) / 2 > 24576 || (chunk1 !== zeroAddress && (!chunk1Code.startsWith("0x00") || chunk1Code.length <= 4 || (chunk1Code.length - 2) / 2 > 24576 || (chunk0Code.length - 2) / 2 !== 24576))) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Bound deployer creation-code chunks are not the immutable typed STOP-prefixed graph");
  const creationCode = concatHex([`0x${chunk0Code.slice(4)}`, chunk1 === zeroAddress ? "0x" : `0x${chunk1Code.slice(4)}`]);
  const expectedDigest = keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
    { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" },
  ], [chainId, orchestrator, keccak256(coreCode), manager, keccak256(managerCode), oracleFactory, keccak256(oracleCode), locker, keccak256(lockerCode), collectorFactory, keccak256(collectorFactoryCode), deployer, keccak256(deployerCode), creationCodeHash, chunk0, keccak256(chunk0Code), chunk1, chunk1 === zeroAddress ? zeroHash : keccak256(chunk1Code)]));
  if (version !== 3 || registration.hook !== zeroAddress || topology.hookDeployer.toLowerCase() !== deployer.toLowerCase() || creationCodeHash === zeroHash || topology.hookCreationCodeHash.toLowerCase() !== creationCodeHash.toLowerCase() || keccak256(creationCode).toLowerCase() !== creationCodeHash.toLowerCase() || expectedDigest.toLowerCase() !== digest.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Bound V4 deployer, creation bytecode and immutable dependency graph differ from certified topology");
  return { topology, boundGraph: { manager, oracleFactory, locker, collectorFactory, deployer, creationCode } };
}

export async function readLifecycleProfiles(options: { client: LifecycleRpcClient; orchestrator: Address; profileIds?: readonly Hex[]; offset?: bigint; limit?: bigint }, pinnedBlock?: LifecycleBlock): Promise<LifecycleProfile[]> {
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const chainId = rpcQuantity(await lifecycleRpc(options.client, "eth_chainId"), "chain ID");
  const registry = await readLifecycleContract<Address>(options.client, options.orchestrator, launchLifecycleAbi, "registry", [], block);
  if ((await readLifecycleContract<Address>(options.client, registry, lifecycleRegistryAbi, "core", [], block)).toLowerCase() !== options.orchestrator.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Registry is not bound to the selected lifecycle orchestrator");
  const ids = options.profileIds ?? await readLifecycleContract<readonly Hex[]>(options.client, registry, lifecycleRegistryAbi, "profileIds", [options.offset ?? 0n, options.limit ?? 100n], block);
  const profiles: LifecycleProfile[] = [];
  for (const id of ids) {
    const registration = await readLifecycleContract<ProfileRegistrationV1>(options.client, registry, lifecycleRegistryAbi, "profile", [id], block);
    const adapter = await readLifecycleContract<AdapterRegistrationV1>(options.client, registry, lifecycleRegistryAbi, "adapter", [registration.adapterId], block);
    let topology: ProfileTopologyV1 = { hookTopology: 0, configVersion: adapter.configVersion, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash };
    let admitted = registration.enabled && adapter.enabled && (registration.capabilities & LIFECYCLE_REQUIRED_CAPABILITIES) === LIFECYCLE_REQUIRED_CAPABILITIES && (adapter.capabilities & LIFECYCLE_REQUIRED_CAPABILITIES) === LIFECYCLE_REQUIRED_CAPABILITIES && (registration.capabilities & adapter.capabilities) === registration.capabilities;
    let reason: string | undefined = admitted ? undefined : "Profile or implementation is retired, unregistered, or lacks lifecycle capabilities";
    try {
      const recorded = await readLifecycleProfileTopology(options.client, registry, id, block);
      if (recorded !== undefined) topology = recorded;
      topology = (await certifyLifecycleProfile(options.client, options.orchestrator, id, registration, adapter, recorded, block, chainId)).topology;
      if (admitted) {
        const eligible = await readLifecycleContract<Address>(options.client, registry, lifecycleRegistryAbi, "requireEligible", [registration.adapterId, id, adapter.configVersion, LIFECYCLE_REQUIRED_CAPABILITIES], block);
        if (eligible.toLowerCase() !== adapter.implementation.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Registry eligibility resolves a different implementation");
      }
    } catch (failure) { admitted = false; reason = failure instanceof Error ? failure.message : String(failure); }
    const schema = registration.configSchema.toLowerCase();
    const venueKind = schema === V4_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() || schema === V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "uniswap-v4" : schema === ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "abyss" : "unknown";
    profiles.push({ id, registration, adapter, topology, admitted, reason, venueKind });
  }
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return profiles;
}

async function readPoolBoundHookDeploymentDetails(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }, block: LifecycleBlock): Promise<{ deployment: PoolBoundHookDeployment; parameters: PoolBoundHookParametersV1 }> {
  const { client, plan, marketIndex } = options;
  const market = plan.markets[marketIndex];
  if (market === undefined || market.configVersion !== 3 || market.profileId.toLowerCase() !== V4_POOL_BOUND_LIFECYCLE_PROFILE_ID.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market index must select the exact pool-bound V4 profile/version");
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID");
  if (chainId !== plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed plan");
  const registry = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "registry", [], block);
  if ((await readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "core", [], block)).toLowerCase() !== plan.orchestrator.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Registry is not bound to this lifecycle core");
  const registration = await readLifecycleContract<ProfileRegistrationV1>(client, registry, lifecycleRegistryAbi, "profile", [market.profileId], block);
  const adapter = await readLifecycleContract<AdapterRegistrationV1>(client, registry, lifecycleRegistryAbi, "adapter", [registration.adapterId], block);
  if (registration.adapterId.toLowerCase() !== market.adapterId.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market adapter differs from the profile's immutable registration");
  const recorded = await readLifecycleProfileTopology(client, registry, market.profileId, block);
  const { boundGraph } = await certifyLifecycleProfile(client, plan.orchestrator, market.profileId, registration, adapter, recorded, block, chainId);
  if (boundGraph === undefined) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Market does not have a certified pool-bound deployer graph");
  const token = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "predictToken", [plan], block);
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
  const expected: PoolBoundHookParametersV1 = {
    poolManager: boundGraph.manager, registrar: adapter.implementation, oracleFactory: boundGraph.oracleFactory, core: plan.orchestrator,
    liquidityLocker: boundGraph.locker, token, quoteCurrency: market.quoteAsset, lpFeePips: config.lpFeePips, tickSpacing: config.tickSpacing,
    sqrtPriceX96: config.sqrtPriceX96, hookFeePips: config.hookFeePips, feeMode: config.feeMode, protocolFeeDenominator: config.protocolFeeDenominator,
    treasury: config.treasury, externalLiquidityDisabled: config.externalLiquidityDisabled, oracleConfigId: config.oracleConfigId,
    marketCommitment: hashPoolBoundV4MarketCommitment({ chainId, core: plan.orchestrator, registrar: adapter.implementation, token, market }),
    expectedPositionCount: config.positions.length,
  };
  const [parameters, parameterSalt] = await readLifecycleContract<readonly [PoolBoundHookParametersV1, Hex]>(client, boundGraph.collectorFactory, lifecycleV4CollectorFactoryAbi, "poolBoundHookParameters", [adapter.implementation, token, market], block);
  const [deployer, initCodeHash, salt, predictedHook] = await readLifecycleContract<readonly [Address, Hex, Hex, Address]>(client, adapter.implementation, poolBoundV4LifecycleAdapterAbi, "hookDeploymentMetadata", [token, market], block);
  const remoteInitCodeHash = await readLifecycleContract<Hex>(client, boundGraph.deployer, poolBoundLaunchFeeHookDeployerV1Abi, "initCodeHash", [expected], block);
  const remotePrediction = await readLifecycleContract<Address>(client, boundGraph.deployer, poolBoundLaunchFeeHookDeployerV1Abi, "predict", [expected, config.hookSalt], block);
  const localInitCodeHash = poolBoundHookInitCodeHash(boundGraph.creationCode, expected);
  const localPrediction = predictPoolBoundHookAddress({ deployer: boundGraph.deployer, initCodeHash: localInitCodeHash, salt: config.hookSalt });
  if (encodePoolBoundHookParameters(parameters).toLowerCase() !== encodePoolBoundHookParameters(expected).toLowerCase() || parameterSalt.toLowerCase() !== config.hookSalt.toLowerCase() || salt.toLowerCase() !== config.hookSalt.toLowerCase() || deployer.toLowerCase() !== boundGraph.deployer.toLowerCase() || initCodeHash.toLowerCase() !== localInitCodeHash.toLowerCase() || remoteInitCodeHash.toLowerCase() !== localInitCodeHash.toLowerCase() || predictedHook.toLowerCase() !== localPrediction.toLowerCase() || remotePrediction.toLowerCase() !== localPrediction.toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Bound hook metadata differs from the exact certified constructor economics, factory, initcode, salt or CREATE2 prediction");
  const hookCode = rpcHex(await lifecycleRpc(client, "eth_getCode", [predictedHook, toHex(block.number)]), "bound hook code");
  if (hookCode !== "0x") {
    const deployedCodeHash = await readLifecycleContract<Hex>(client, deployer, poolBoundLaunchFeeHookDeployerV1Abi, "deployedCodeHash", [predictedHook], block);
    if (deployedCodeHash === zeroHash || deployedCodeHash.toLowerCase() !== keccak256(hookCode).toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook lacks this exact typed deployer's runtime-code provenance");
    for (const [getter, expectedAddress] of [
      ["poolManager", expected.poolManager], ["registrar", expected.registrar], ["oracleFactory", expected.oracleFactory],
      ["core", expected.core], ["liquidityLocker", expected.liquidityLocker], ["token", expected.token],
    ] as const) {
      const actual = await readLifecycleContract<Address>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, getter, [], block);
      if (actual.toLowerCase() !== expectedAddress.toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook immutable dependency graph differs from the committed constructor");
    }
    const [currency0, currency1] = BigInt(token) < BigInt(market.quoteAsset) ? [token, market.quoteAsset] : [market.quoteAsset, token];
    const expectedPoolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [currency0, currency1, config.lpFeePips, config.tickSpacing, predictedHook]));
    const actualPoolId = await readLifecycleContract<Hex>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, "boundPoolId", [], block);
    const deploymentConfigHash = await readLifecycleContract<Hex>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, "deploymentConfigHash", [], block);
    const marketCommitment = await readLifecycleContract<Hex>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, "marketCommitment", [], block);
    const opening = await readLifecycleContract<bigint>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, "openingSqrtPriceX96", [], block);
    const positions = await readLifecycleContract<number>(client, predictedHook, poolBoundLaunchFeeHookV1Abi, "expectedPositionCount", [], block);
    if (actualPoolId.toLowerCase() !== expectedPoolId.toLowerCase() || deploymentConfigHash.toLowerCase() !== keccak256(encodePoolBoundHookParameters(expected)).toLowerCase() || marketCommitment.toLowerCase() !== expected.marketCommitment.toLowerCase() || opening !== expected.sqrtPriceX96 || positions !== expected.expectedPositionCount) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook key, economic commitment or immutable opening geometry changed");
  }
  return { deployment: { deployer, initCodeHash, salt, predictedHook }, parameters: expected };
}

/** Works with an unmined candidate salt and after preparation; never accepts a caller-selected root. */
export async function readPoolBoundHookDeployment(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }, pinnedBlock?: LifecycleBlock): Promise<PoolBoundHookDeployment> {
  const commitment = hashLaunchPlan(options.plan);
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  const { deployment } = await readPoolBoundHookDeploymentDetails(options, block);
  if (hashLaunchPlan(options.plan) !== commitment) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed while reading hook deployment metadata");
  if (pinnedBlock === undefined) await assertLifecycleBlock(options.client, block);
  return deployment;
}

/** Optional permissionless predeployment calldata; no token deployment, pool registration or wallet broadcast. */
export async function buildPoolBoundHookDeploymentTransaction(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }): Promise<{ to: Address; data: Hex; value: bigint; deployment: PoolBoundHookDeployment }> {
  const commitment = hashLaunchPlan(options.plan);
  const block = await readLifecycleBlock(options.client);
  const { deployment, parameters } = await readPoolBoundHookDeploymentDetails(options, block);
  if (!hasLifecycleV4HookPermissions(deployment.predictedHook)) throw new LifecyclePlanningError("INVALID_HOOK_BITS", "Finalize a salt with the exact lifecycle hook permissions before predeployment");
  if (hashLaunchPlan(options.plan) !== commitment) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed while constructing hook deployment calldata");
  await assertLifecycleBlock(options.client, block);
  return { to: deployment.deployer, data: encodeFunctionData({ abi: poolBoundLaunchFeeHookDeployerV1Abi, functionName: "deploy", args: [parameters, deployment.salt] }), value: 0n, deployment };
}

export function validateLifecycleMarketIdentity(identity: MarketIdentityV1, plan: LaunchPlanV1, token: Address, marketIndex: number): void {
  const market = plan.markets[marketIndex];
  if (market === undefined) throw new LifecyclePlanningError("MARKET_IDENTITY", "Market index is outside the economic plan");
  const [currency0, currency1] = BigInt(token) < BigInt(market.quoteAsset) ? [token, market.quoteAsset] : [market.quoteAsset, token];
  const expectedCanonicalId = keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "uint8" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" },
  ], [plan.chainId, identity.venue, identity.manager, identity.factory, identity.pool, identity.poolId, identity.profileId]));
  if (identity.canonicalId.toLowerCase() !== expectedCanonicalId.toLowerCase() || identity.profileId.toLowerCase() !== market.profileId.toLowerCase() || identity.currency0.toLowerCase() !== currency0?.toLowerCase() || identity.currency1.toLowerCase() !== currency1?.toLowerCase() || identity.openingSqrtPriceX96 === 0n || identity.tickSpacing <= 0) throw new LifecyclePlanningError("MARKET_IDENTITY", "Venue identity does not match canonical chain, plan, currencies and opening price");
  if (identity.venue === LifecycleVenue.UniswapV4) {
    const expectedPoolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [identity.currency0, identity.currency1, identity.fee, identity.tickSpacing, identity.hook]));
    if (identity.manager === zeroAddress || identity.factory !== zeroAddress || identity.pool !== zeroAddress || identity.poolId.toLowerCase() !== expectedPoolId.toLowerCase() || !hasLifecycleV4HookPermissions(identity.hook)) throw new LifecyclePlanningError("MARKET_IDENTITY", "V4 full permissioned PoolKey identity differs from its canonical pool ID");
  } else if (identity.venue !== LifecycleVenue.Abyss || identity.pool === zeroAddress || identity.factory === zeroAddress) throw new LifecyclePlanningError("MARKET_IDENTITY", "Abyss canonical factory/pool identity is missing");
}

async function transactionMatchesLaunch(transaction: Record<string, unknown>, options: ReadLaunchProgressOptions, block: LifecycleBlock): Promise<boolean> {
  const { planned } = options;
  const from = rpcHex(transaction.from, "receipt transaction account");
  if (from.toLowerCase() !== planned.account.toLowerCase()) throw new LifecyclePlanningError("RECEIPT_ACCOUNT", "Receipt transaction belongs to a different account");
  if (transaction.chainId !== undefined && rpcQuantity(transaction.chainId, "receipt transaction chain") !== planned.plan.chainId) throw new LifecyclePlanningError("RECEIPT_CHAIN", "Receipt transaction belongs to a different chain");
  const to = transaction.to === null ? zeroAddress : rpcHex(transaction.to, "receipt transaction target");
  const input = rpcHex(transaction.input ?? transaction.data, "receipt transaction calldata");
  if (to.toLowerCase() === planned.plan.orchestrator.toLowerCase()) {
    try {
      const decoded = decodeFunctionData({ abi: launchLifecycleAbi, data: input });
      if (!["launchAtomic", "beginLaunch", "prepareMarkets", "activateLaunch", "cancelLaunch"].includes(decoded.functionName) || !Array.isArray(decoded.args)) return false;
      // Decoded plan layout is validated by the exact ABI, not trusted raw RPC JSON.
      const plan = decoded.args[0] as LaunchPlanV1;
      return hashLaunchPlan(plan).toLowerCase() === planned.planHash.toLowerCase();
    } catch { return false; }
  }
  const fundingAsset = planned.plan.funding.some((funding) => funding.inputAsset.toLowerCase() === to.toLowerCase());
  if (!fundingAsset) return false;
  let spender: Address;
  try {
    const decoded = decodeFunctionData({ abi: lifecycleErc20Abi, data: input });
    if (decoded.functionName !== "approve" || rpcQuantity(transaction.value ?? "0x0", "approval native value") !== 0n) return false;
    spender = decoded.args[0];
  } catch { return false; }
  const escrow = await readLifecycleContract<Address>(options.client, planned.plan.orchestrator, launchLifecycleAbi, "fundingEscrow", [], block);
  return spender.toLowerCase() === escrow.toLowerCase();
}

async function readReceipt(reference: LifecycleReceiptReference, options: ReadLaunchProgressOptions, block: LifecycleBlock): Promise<LifecycleReceiptStatus> {
  const effectiveHash = reference.replacementHash ?? reference.transactionHash;
  const base = { transactionHash: reference.transactionHash, effectiveHash, replaced: reference.replacementHash !== undefined && reference.replacementHash.toLowerCase() !== reference.transactionHash.toLowerCase() };
  const observedNumber = reference.observedBlockNumber;
  if (observedNumber !== undefined && reference.observedBlockHash !== undefined) {
    const observed = await lifecycleRpc(options.client, "eth_getBlockByNumber", [toHex(observedNumber), false]);
    if (observed === null || rpcHex(rpcObject(observed, "observed receipt block").hash, "observed receipt block hash").toLowerCase() !== reference.observedBlockHash.toLowerCase()) return { ...base, status: "reorged", blockNumber: observedNumber, blockHash: reference.observedBlockHash };
  }
  const receiptValue = await lifecycleRpc(options.client, "eth_getTransactionReceipt", [effectiveHash]);
  const transactionValue = await lifecycleRpc(options.client, "eth_getTransactionByHash", [effectiveHash]);
  if (receiptValue === null) {
    // An absent receipt with an unchanged canonical observed block is not a
    // reorg: the transaction is simply not (yet) mined. A missing/changed
    // canonical block above already reported the real reorg.
    if (reference.observedBlockHash !== undefined) return { ...base, status: "pending", blockNumber: observedNumber, blockHash: reference.observedBlockHash };
    return { ...base, status: "pending" };
  }
  if (transactionValue === null) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Receipt exists without its canonical transaction");
  const transaction = rpcObject(transactionValue, "receipt transaction");
  const receiptBlock = await readLifecycleBlock(options.client, toHex(rpcQuantity(rpcObject(receiptValue, "receipt").blockNumber, "receipt block number")));
  const matches = await transactionMatchesLaunch(transaction, options, receiptBlock);
  if (!matches && !base.replaced) throw new LifecyclePlanningError("RECEIPT_IDENTITY", "Receipt calldata does not belong to the exact committed launch");
  const receipt = rpcObject(receiptValue, "receipt");
  const blockNumber = rpcQuantity(receipt.blockNumber, "receipt block number");
  const blockHash = rpcHex(receipt.blockHash, "receipt block hash");
  const canonicalBlockValue = await lifecycleRpc(options.client, "eth_getBlockByNumber", [toHex(blockNumber), false]);
  if (canonicalBlockValue === null || rpcHex(rpcObject(canonicalBlockValue, "receipt canonical block").hash, "receipt canonical hash").toLowerCase() !== blockHash.toLowerCase()) return { ...base, status: "reorged", blockNumber, blockHash };
  const confirmations = block.number >= blockNumber ? block.number - blockNumber + 1n : 0n;
  const required = reference.confirmations ?? 1;
  if (!Number.isSafeInteger(required) || required < 1) throw new LifecyclePlanningError("INVALID_CONFIRMATIONS", "Receipt confirmations must be a positive integer");
  if (confirmations < BigInt(required)) return { ...base, status: "unconfirmed", blockNumber, blockHash, confirmations };
  if (!matches) return { ...base, status: "replacement-cancelled", blockNumber, blockHash, confirmations };
  if (rpcQuantity(receipt.status, "receipt status") !== 1n) return { ...base, status: "reverted", blockNumber, blockHash, confirmations };
  return { ...base, status: "confirmed", blockNumber, blockHash, confirmations };
}

/** Reads confirmation-bound canonical state and receipt provenance; local step counters are never used. */
export async function readLaunchProgress(options: ReadLaunchProgressOptions, pinnedBlock?: LifecycleBlock): Promise<CanonicalLaunchProgress> {
  const { client, planned } = options;
  const block = pinnedBlock ?? await readLifecycleBlock(client);
  const confirmationDepth = options.confirmations ?? planned.confirmations;
  if (!Number.isSafeInteger(confirmationDepth) || confirmationDepth < 1) throw new LifecyclePlanningError("INVALID_CONFIRMATIONS", "Confirmation depth must be a positive integer");
  const confirmedNumber = block.number >= BigInt(confirmationDepth - 1) ? block.number - BigInt(confirmationDepth - 1) : 0n;
  const confirmedBlock = confirmedNumber === block.number ? block : await readLifecycleBlock(client, toHex(confirmedNumber));
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID");
  if (chainId !== planned.plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed launch");
  if (planned.account.toLowerCase() !== planned.plan.creator.toLowerCase()) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account must be the committed creator/payer/refund account");
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored economic plan no longer matches its commitment");
  const head = await readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], block, planned.account);
  const canonical = confirmedNumber === block.number ? head : await readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], confirmedBlock, planned.account);
  const token = await readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "predictToken", [planned.plan], block);
  if (token.toLowerCase() !== planned.predictedToken.toLowerCase()) throw new LifecyclePlanningError("TOKEN_IDENTITY", "Predicted token changed for the committed token configuration");
  for (const progress of [canonical, head]) if (progress.phase !== LifecyclePhase.None) {
    if (progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.launchId.toLowerCase() !== planned.launchId.toLowerCase() || progress.creator.toLowerCase() !== planned.account.toLowerCase() || progress.nonce !== planned.plan.nonce || progress.token.toLowerCase() !== token.toLowerCase() || progress.marketCount !== planned.plan.markets.length || progress.buyCount !== planned.plan.buys.length || progress.deadline !== planned.plan.deadline) throw new LifecyclePlanningError("PLAN_REPLAY", "This creator nonce is already bound to a different economic launch");
    if (progress.mode !== (planned.mode === "atomic" ? LifecycleMode.Atomic : LifecycleMode.Staged)) throw new LifecyclePlanningError("MODE_MISMATCH", "Execution mode differs from the already recorded launch");
    if (progress.preparedMarkets > progress.marketCount || progress.phase === LifecyclePhase.Activating || (progress.phase === LifecyclePhase.Ready && progress.preparedMarkets !== progress.marketCount)) throw new LifecyclePlanningError("INVALID_PROGRESS", "Canonical progress violates the committed ordered state machine");
  }
  const confirmedAccountNonce = rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(confirmedBlock.number)]), "confirmed account nonce");
  const headAccountNonce = confirmedNumber === block.number ? confirmedAccountNonce : rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(block.number)]), "head account nonce");
  const pendingAccountNonce = rpcQuantity(await lifecycleRpc(client, "eth_getTransactionCount", [planned.account, "pending"]), "pending account nonce");
  const progressParameters = [{ type: "tuple", components: launchProgressV1Components }] as const;
  const confirmationSafe = confirmedAccountNonce === headAccountNonce && pendingAccountNonce === headAccountNonce && keccak256(encodeAbiParameters(progressParameters, [canonical])) === keccak256(encodeAbiParameters(progressParameters, [head]));
  const receipts: LifecycleReceiptStatus[] = [];
  for (const reference of options.receipts ?? []) receipts.push(await readReceipt({ ...reference, confirmations: Math.max(reference.confirmations ?? 1, confirmationDepth) }, options, block));
  const markets: LifecycleMarketProgress[] = [];
  if (canonical.preparedMarkets > 0) {
    const directory = await readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "directory", [], confirmedBlock);
    for (let index = 0; index < canonical.preparedMarkets; index += 1) {
      const [adapter, prepared] = await readLifecycleContract<readonly [Address, PreparedMarketV1]>(client, directory, lifecycleDirectoryAbi, "market", [planned.launchId, index], confirmedBlock);
      validateLifecycleMarketIdentity(prepared.identity, planned.plan, token, index);
      try {
        const live = await readLifecycleContract<MarketLiveStateV1>(client, adapter, lifecycleAdapterAbi, "readMarket", [planned.launchId, index], confirmedBlock);
        markets.push({ index, prepared, live });
      } catch (failure) {
        markets.push({ index, prepared, error: failure instanceof Error ? failure.message : String(failure) });
      }
    }
  }
  if (pinnedBlock === undefined) await assertLifecycleBlock(client, block);
  if (confirmedNumber !== block.number) await assertLifecycleBlock(client, confirmedBlock);
  return { canonical, head, confirmationDepth, confirmedBlockNumber: confirmedBlock.number, confirmedBlockHash: confirmedBlock.hash, confirmedAccountNonce, headAccountNonce, pendingAccountNonce, confirmationSafe, token, planHash: planned.planHash, launchId: planned.launchId, chainId, blockNumber: block.number, blockHash: block.hash, markets, receipts };
}
