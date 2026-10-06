import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, stringToHex, toHex, zeroAddress, zeroHash, type Address, type Hash, type Hex } from "viem";
import { abyssLifecycleAdapterAbi, launchLifecycleAbi, lifecycleAdapterAbi, lifecycleDirectoryAbi, lifecycleErc20Abi, lifecycleOracleFactoryAbi, lifecycleRegistryAbi, poolFeeCollectorFactoryV1Abi, lifecycleV4HookAbi, lifecycleV4LockerAbi, poolHookDeployerV1Abi, sharedHookDeployerV1Abi, fixedFeePoolHookV1Abi, poolMarketAdapterV1Abi, sharedMarketAdapterV1Abi } from "./abi.js";
import { decodePoolBoundV4LifecycleMarketConfig, encodePoolBoundHookParameters, hasLifecycleV4HookPermissions, hashPoolBoundV4MarketCommitment, poolBoundHookInitCodeHash, predictPoolBoundHookAddress, validateV4LifecycleMarket, V4_LIFECYCLE_CONFIG_SCHEMA, V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA, type PoolBoundHookParametersV1 } from "./markets.js";
import { hashLaunchIdentity, hashLaunchPlan, hashLaunchBounds, hashLaunchDependencies, hashLifecycleProfile, launchProgressV1Components, LifecycleMode, LifecyclePhase, LifecycleVenue, LIFECYCLE_REQUIRED_CAPABILITIES, LIFECYCLE_ERC404_CAPABILITY, LIFECYCLE_MULTI_POSITION_CAPABILITY, type AdapterRegistrationV1, type LaunchPlanV1, type LaunchProgressV1, type MarketIdentityV1, type MarketLiveStateV1, type PreparedMarketV1, type ProfileRegistrationV1, type ProfileTopologyV1, type LaunchEnvelopeV2, type LifecycleDeveloperTerms } from "./schema.js";
import { assertLifecycleBlock, lifecyclePinnedRpc, lifecycleRpc, readLifecycleBlock, readLifecycleContract, readLifecycleProfileTopology, rpcHex, rpcObject, rpcQuantity, withLifecycleReadClient } from "./rpc.js";
import { LifecyclePlanningError, type CanonicalLaunchProgress, type LifecycleBlock, type LifecycleMarketProgress, type LifecycleProfile, type LifecycleReceiptReference, type LifecycleReceiptStatus, type LifecycleRpcClient, type PoolBoundHookDeployment, type ReadLaunchProgressOptions } from "./types.js";

export const ABYSS_LIFECYCLE_CONFIG_SCHEMA = keccak256(stringToHex("(uint8,uint24,bytes32,uint160,(int24,int24,uint128,uint256)[])"));

export async function predictLifecycleToken(options: { client: LifecycleRpcClient; plan: LaunchPlanV1 }): Promise<Address> {
  const block = await readLifecycleBlock(options.client);
  const token = await readLifecycleContract<Address>(options.client, options.plan.orchestrator, launchLifecycleAbi, "predictToken", [options.plan], block);
  await assertLifecycleBlock(options.client, block);
  return token;
}

type BoundProfileGraph = { manager: Address; oracleFactory: Address; locker: Address; collectorFactory: Address; deployer: Address; creationCode: Hex };

async function readDependencyCode(client: LifecycleRpcClient, address: Address, block: LifecycleBlock): Promise<Hex> {
  const code = rpcHex(await lifecyclePinnedRpc(client, "eth_getCode", [address, toHex(block.number)], block), "lifecycle dependency code");
  if (address === zeroAddress || code === "0x") throw new LifecyclePlanningError("PROFILE_DEPENDENCY", `Lifecycle dependency ${address} has no deployed code`);
  return code;
}

async function certifyLifecycleProfile(client: LifecycleRpcClient, orchestrator: Address, registry: Address, id: Hex, registration: ProfileRegistrationV1, adapter: AdapterRegistrationV1, topology: ProfileTopologyV1, envelope: LaunchEnvelopeV2 | undefined, block: LifecycleBlock, chainId: bigint): Promise<{ topology: ProfileTopologyV1; boundGraph?: BoundProfileGraph }> {
  const shared = registration.configSchema.toLowerCase() === V4_LIFECYCLE_CONFIG_SCHEMA.toLowerCase();
  const bound = registration.configSchema.toLowerCase() === V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA.toLowerCase();
  const abyss = registration.configSchema.toLowerCase() === ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase();
  if (!shared && !bound && !abyss) throw new LifecyclePlanningError("UNSUPPORTED_SCHEMA", `Unsupported lifecycle config schema ${registration.configSchema}`);
  const version = shared ? 4 : bound ? 5 : 1;
  if (adapter.configVersion !== version || topology.configVersion !== version || topology.hookTopology !== (shared ? 1 : bound ? 2 : 0)) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Registry topology/version differs from the supported config schema");
  const [implementationCode, authority, digest] = await Promise.all([
    readDependencyCode(client, adapter.implementation, block),
    readLifecycleContract<Address>(client, adapter.implementation, lifecycleAdapterAbi, "core", [], block),
    readLifecycleContract<Hex>(client, adapter.implementation, lifecycleAdapterAbi, "dependencyDigest", [], block),
  ]);
  if (keccak256(implementationCode).toLowerCase() !== adapter.codeHash.toLowerCase()) throw new LifecyclePlanningError("PROFILE_CODE_HASH", "Adapter code hash differs from immutable registry approval");
  if (authority.toLowerCase() !== orchestrator.toLowerCase() || digest.toLowerCase() !== registration.dependencyDigest.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Adapter authority or dependency digest differs from immutable registry approval");
  if (abyss) {
    if (topology.hookDeployer !== zeroAddress || topology.hookCreationCodeHash !== zeroHash) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Abyss does not admit a V4 hook deployment graph");
    const [factory, schema, actualVersion] = await Promise.all([
      readLifecycleContract<Address>(client, adapter.implementation, abyssLifecycleAdapterAbi, "factory", [], block),
      readLifecycleContract<Hex>(client, adapter.implementation, abyssLifecycleAdapterAbi, "CONFIG_SCHEMA", [], block),
      readLifecycleContract<number>(client, adapter.implementation, abyssLifecycleAdapterAbi, "CONFIG_VERSION", [], block),
    ]);
    const domain = keccak256(stringToHex("BLACK_MARKET_ABYSS_CANONICAL_PROFILE_V1"));
    const known = [0, 1, 2, 3].some((variant) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }], [domain, chainId, factory, variant])).toLowerCase() === id.toLowerCase());
    if (!known || schema.toLowerCase() !== ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() || actualVersion !== 1 || registration.factory.toLowerCase() !== factory.toLowerCase() || registration.venue.toLowerCase() !== factory.toLowerCase() || registration.hook !== zeroAddress) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Abyss profile is not the exact canonical factory/variant/schema binding");
    await readDependencyCode(client, factory, block);
    return { topology };
  }
  if (envelope === undefined || envelope.topology !== topology.hookTopology || envelope.configVersion !== version || envelope.economicVersion !== 3 ||
    envelope.flags !== 0n || envelope.callbackFlags !== 0x1afc || envelope.callbackMask !== 0x3fff ||
    envelope.artifactDigest === zeroHash || envelope.reviewManifestDigest === zeroHash || envelope.termsDigest === zeroHash ||
    hashLifecycleProfile(envelope).toLowerCase() !== id.toLowerCase() ||
    hashLaunchBounds(envelope.bounds).toLowerCase() !== envelope.configBoundsDigest.toLowerCase() ||
    envelope.capabilities !== registration.capabilities || envelope.capabilities !== adapter.capabilities ||
    (envelope.capabilities & ~(LIFECYCLE_REQUIRED_CAPABILITIES | LIFECYCLE_ERC404_CAPABILITY | LIFECYCLE_MULTI_POSITION_CAPABILITY)) !== 0n) {
    throw new LifecyclePlanningError("PROFILE_ENVELOPE", "Frozen reviewed profile identity, bounds, capabilities or economic version differs from registry admission");
  }
  const b = envelope.bounds;
  if (b.minimumTickSpacing < 1 ||
    b.maximumTickSpacing > 32767 || b.minimumTickSpacing > b.maximumTickSpacing || b.maximumPositions < 1 || b.maximumPositions > 32 ||
    b.maximumOracleCardinality < 2 || b.maximumOracleCardinality > 4096 || b.feeModeFlags === 0 || (b.feeModeFlags & ~3) !== 0 ||
    envelope.protocolTreasury === zeroAddress || (envelope.protocolFeeDenominator !== 0 && (envelope.protocolFeeDenominator < 4 || envelope.protocolFeeDenominator > 10))) throw new LifecyclePlanningError("PROFILE_BOUNDS", "Registry envelope has unsupported executable bounds");
  const abi = bound ? poolMarketAdapterV1Abi : sharedMarketAdapterV1Abi;
  const [metadata, actualVersion] = await Promise.all([
    Promise.all((["PROFILE_ID", "CONFIG_SCHEMA", "implementationRegistry"] as const).map((getter) => readLifecycleContract<Hex>(client, adapter.implementation, abi, getter, [], block))),
    readLifecycleContract<number>(client, adapter.implementation, abi, "CONFIG_VERSION", [], block),
  ]);
  for (const [index, expected] of [id, registration.configSchema, registry].entries()) {
    if (metadata[index]?.toLowerCase() !== expected.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed adapter metadata differs from registry certification");
  }
  if (actualVersion !== version) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed adapter config version differs from certification");
  const g = envelope.graph;
  if (registration.factory !== zeroAddress || registration.venue.toLowerCase() !== g.manager.toLowerCase() || registration.hook.toLowerCase() !== g.hookRoot.toLowerCase() ||
    topology.hookDeployer.toLowerCase() !== g.hookDeployer.toLowerCase() || topology.hookCreationCodeHash.toLowerCase() !== g.hookCreationCodeHash.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed venue/topology differs from the frozen envelope graph");
  const deployerAbi = shared ? sharedHookDeployerV1Abi : poolHookDeployerV1Abi;
  const codeBindings = [[orchestrator, g.coreCodeHash], [g.manager, g.managerCodeHash], [g.oracleFactory, g.oracleFactoryCodeHash],
    [g.locker, g.lockerCodeHash], [g.collectorFactory, g.collectorFactoryCodeHash], [g.collectorDeployer, g.collectorDeployerCodeHash],
    [g.hookDeployer, g.hookDeployerCodeHash]] as const;
  const [dependencies, dependencyCodes, collectorDeployer, launcher, lockerManager, creationCodeHash, chunk0, chunk1] = await Promise.all([
    Promise.all((["poolManager", "hookRoot", "oracleFactory", "locker", "collectorFactory", "hookDeployer"] as const).map((getter) => readLifecycleContract<Address>(client, adapter.implementation, abi, getter, [], block))),
    Promise.all(codeBindings.map(([address]) => readDependencyCode(client, address, block))),
    readLifecycleContract<Address>(client, g.collectorFactory, poolFeeCollectorFactoryV1Abi, "collectorDeployer", [], block),
    readLifecycleContract<Address>(client, g.locker, lifecycleV4LockerAbi, "launcher", [], block),
    readLifecycleContract<Address>(client, g.locker, lifecycleV4LockerAbi, "poolManager", [], block),
    readLifecycleContract<Hex>(client, g.hookDeployer, deployerAbi, "creationCodeHash", [], block),
    readLifecycleContract<Address>(client, g.hookDeployer, deployerAbi, "codeChunk0", [], block),
    readLifecycleContract<Address>(client, g.hookDeployer, deployerAbi, "codeChunk1", [], block),
  ]);
  for (const [index, expected] of [g.manager, g.hookRoot, g.oracleFactory, g.locker, g.collectorFactory, g.hookDeployer].entries()) {
    if (dependencies[index]?.toLowerCase() !== expected.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Live adapter dependency differs from the frozen reviewed graph");
  }
  for (const [index, [, expectedHash]] of codeBindings.entries()) {
    if (keccak256(dependencyCodes[index]!).toLowerCase() !== expectedHash.toLowerCase()) throw new LifecyclePlanningError("PROFILE_CODE_HASH", "Live runtime differs from the frozen reviewed graph hash");
  }
  if (collectorDeployer.toLowerCase() !== g.collectorDeployer.toLowerCase() || launcher.toLowerCase() !== adapter.implementation.toLowerCase() ||
    lockerManager.toLowerCase() !== g.manager.toLowerCase() || g.locker.toLowerCase() === g.manager.toLowerCase() || g.locker.toLowerCase() === g.hookRoot.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed collector or locker authority differs from the frozen graph");
  const [chunk0Code, chunk1Code] = await Promise.all([
    readDependencyCode(client, chunk0, block),
    chunk1 === zeroAddress ? Promise.resolve<Hex>("0x") : readDependencyCode(client, chunk1, block),
  ]);
  if (chunk0.toLowerCase() !== g.codeChunk0.toLowerCase() || chunk1.toLowerCase() !== g.codeChunk1.toLowerCase() || chunk0.toLowerCase() === chunk1.toLowerCase() ||
    !chunk0Code.startsWith("0x00") || chunk0Code.length <= 4 || (chunk0Code.length - 2) / 2 > 24576 ||
    (chunk1 !== zeroAddress && (!chunk1Code.startsWith("0x00") || chunk1Code.length <= 4 || (chunk1Code.length - 2) / 2 > 24576 || (chunk0Code.length - 2) / 2 !== 24576)) ||
    keccak256(chunk0Code).toLowerCase() !== g.codeChunk0Hash.toLowerCase() || (chunk1 === zeroAddress ? zeroHash : keccak256(chunk1Code)).toLowerCase() !== g.codeChunk1Hash.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed deployer chunks differ from exact immutable STOP-prefixed bytecode evidence");
  const creationCode = concatHex([`0x${chunk0Code.slice(4)}`, chunk1 === zeroAddress ? "0x" : `0x${chunk1Code.slice(4)}`]);
  if ((creationCode.length - 2) / 2 + (shared ? 96 : 576) > 49152 || creationCodeHash === zeroHash ||
    creationCodeHash.toLowerCase() !== g.hookCreationCodeHash.toLowerCase() || keccak256(creationCode).toLowerCase() !== creationCodeHash.toLowerCase() ||
    hashLaunchDependencies({ chainId, core: orchestrator, registry, registrar: adapter.implementation, graph: g }).toLowerCase() !== digest.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Reviewed creation artifact, constructor bound or graph digest differs from admission");
  if (shared) {
    const [rootCode, recordedHash, remotePrediction, dependencies, requiredFlags, allFlags] = await Promise.all([
      readDependencyCode(client, g.hookRoot, block),
      readLifecycleContract<Hex>(client, g.hookDeployer, deployerAbi, "deployedCodeHash", [g.hookRoot], block),
      readLifecycleContract<Address>(client, g.hookDeployer, sharedHookDeployerV1Abi, "predict", [g.manager, adapter.implementation, g.oracleFactory, g.sharedHookSalt], block),
      Promise.all((["registrar", "poolManager", "oracleFactory"] as const).map((getter) => readLifecycleContract<Address>(client, g.hookRoot, lifecycleV4HookAbi, getter, [], block))),
      readLifecycleContract<bigint>(client, g.hookRoot, lifecycleV4HookAbi, "REQUIRED_HOOK_FLAGS", [], block),
      readLifecycleContract<bigint>(client, g.hookRoot, lifecycleV4HookAbi, "ALL_HOOK_MASK", [], block),
    ]);
    const initCodeHash = keccak256(concatHex([creationCode, encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [g.manager, adapter.implementation, g.oracleFactory])]));
    const prediction = predictPoolBoundHookAddress({ deployer: g.hookDeployer, initCodeHash, salt: g.sharedHookSalt });
    if (recordedHash === zeroHash || recordedHash.toLowerCase() !== g.hookRuntimeCodeHash.toLowerCase() || keccak256(rootCode).toLowerCase() !== recordedHash.toLowerCase() ||
      !hasLifecycleV4HookPermissions(g.hookRoot) || prediction.toLowerCase() !== g.hookRoot.toLowerCase() || remotePrediction.toLowerCase() !== prediction.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Shared root lacks exact typed-deployer runtime and constructor/salt provenance");
    for (const [index, expected] of [adapter.implementation, g.manager, g.oracleFactory].entries()) {
      if (dependencies[index]?.toLowerCase() !== expected.toLowerCase()) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Shared hook immutable graph differs from admission");
    }
    if (requiredFlags !== 0x1afcn || allFlags !== 0x3fffn) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Shared hook callbacks differ from admission");
  } else if (g.hookRoot !== zeroAddress || g.hookRuntimeCodeHash !== zeroHash || g.sharedHookSalt !== zeroHash) throw new LifecyclePlanningError("PROFILE_DEPENDENCY", "Bound topology cannot reuse a shared root");
  if ([zeroAddress, orchestrator, registry, adapter.implementation, g.manager, g.hookRoot, g.locker, g.collectorFactory, g.collectorDeployer, g.hookDeployer].some((address) => address.toLowerCase() === envelope.beneficiary.toLowerCase())) throw new LifecyclePlanningError("PROFILE_TERMS", "Stable author identity is an excluded reviewed graph destination");
  return { topology, boundGraph: bound ? { manager: g.manager, oracleFactory: g.oracleFactory, locker: g.locker, collectorFactory: g.collectorFactory, deployer: g.hookDeployer, creationCode } : undefined };
}

/** Validate the market-selected registered oracle against the certified factory at the pinned block. */
export async function validateV4LifecycleOracle(options: {
  client: LifecycleRpcClient; envelope: LaunchEnvelopeV2; oracleConfigId: Hex; block: LifecycleBlock;
}): Promise<void> {
  const { client, envelope, oracleConfigId, block } = options;
  if (oracleConfigId.toLowerCase() === zeroHash) throw new LifecyclePlanningError("INVALID_ORACLE_CONFIG", "Market oracle configuration must be nonzero");
  const [move, cardinality] = await readLifecycleContract<readonly [number, number]>(client, envelope.graph.oracleFactory, lifecycleOracleFactoryAbi, "oracleConfigs", [oracleConfigId], block);
  if (move <= 0 || move > 887272 || cardinality < 2 || cardinality > envelope.bounds.maximumOracleCardinality) {
    throw new LifecyclePlanningError("INVALID_ORACLE_CONFIG", "Selected market oracle is unregistered or exceeds the admitted cardinality bounds");
  }
}

export async function readLifecycleProfiles(options: { client: LifecycleRpcClient; orchestrator: Address; profileIds?: readonly Hex[]; offset?: bigint; limit?: bigint }, pinnedBlock?: LifecycleBlock): Promise<LifecycleProfile[]> {
  return withLifecycleReadClient(options.client, async (client) => {
    const [block, chainIdValue] = await Promise.all([
      pinnedBlock ?? readLifecycleBlock(client),
      lifecycleRpc(client, "eth_chainId"),
    ]);
    const chainId = rpcQuantity(chainIdValue, "chain ID");
    const registry = await readLifecycleContract<Address>(client, options.orchestrator, launchLifecycleAbi, "registry", [], block);
    const offset = options.offset ?? 0n; const limit = options.limit ?? 100n;
    if (offset < 0n || limit < 0n || limit > 100n) throw new LifecyclePlanningError("INVALID_PROFILE_PAGE", "Registry profile pages require unsigned offset and limit at most 100");
    const [authority, ids] = await Promise.all([
      readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "core", [], block),
      options.profileIds ?? readLifecycleContract<readonly Hex[]>(client, registry, lifecycleRegistryAbi, "profileIds", [offset, limit], block),
    ]);
    if (authority.toLowerCase() !== options.orchestrator.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Registry is not bound to the selected lifecycle orchestrator");
    let protocolMaximumDeveloperFeeBpsPromise: Promise<number> | undefined;
    const readProtocolMaximumDeveloperFeeBps = () => protocolMaximumDeveloperFeeBpsPromise ??=
      readLifecycleContract<number>(client, registry, lifecycleRegistryAbi, "protocolMaximumDeveloperFeeBps", [], block);
    const profiles = await Promise.all(ids.map(async (id): Promise<LifecycleProfile> => {
      const registration = await readLifecycleContract<ProfileRegistrationV1>(client, registry, lifecycleRegistryAbi, "profile", [id], block);
      const adapter = await readLifecycleContract<AdapterRegistrationV1>(client, registry, lifecycleRegistryAbi, "adapter", [registration.adapterId], block);
      const schema = registration.configSchema.toLowerCase();
      const venueKind = schema === V4_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() || schema === V4_POOL_BOUND_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "uniswap-v4" : schema === ABYSS_LIFECYCLE_CONFIG_SCHEMA.toLowerCase() ? "abyss" : "unknown";
      let topology: ProfileTopologyV1 = { hookTopology: 0, configVersion: adapter.configVersion, hookDeployer: zeroAddress, hookCreationCodeHash: zeroHash };
      let envelope: LaunchEnvelopeV2 | undefined; let developerTerms: LifecycleDeveloperTerms | undefined;
      let protocolMaximumDeveloperFeeBps: number | undefined;
      let admitted = false; let reason: string | undefined;
      try {
        if (venueKind === "unknown") throw new LifecyclePlanningError("UNSUPPORTED_SCHEMA", `Unsupported lifecycle config schema ${registration.configSchema}`);
        const [recordedTopology, reviewed] = await Promise.all([
          readLifecycleProfileTopology(client, registry, id, block),
          venueKind === "uniswap-v4" ? Promise.all([
            readLifecycleContract<LaunchEnvelopeV2>(client, registry, lifecycleRegistryAbi, "profileEnvelope", [id], block),
            readLifecycleContract<readonly [Address, Address, number, Hex, boolean]>(client, registry, lifecycleRegistryAbi, "developerTerms", [id], block),
            readProtocolMaximumDeveloperFeeBps(),
          ]) : undefined,
        ]);
        topology = recordedTopology;
        if (reviewed !== undefined) {
          envelope = reviewed[0];
          protocolMaximumDeveloperFeeBps = reviewed[2];
          const [implementation, beneficiary, maximumDeveloperFeeBps, termsDigest, enabled] = reviewed[1];
          developerTerms = { adapter: implementation, beneficiary, maximumDeveloperFeeBps, termsDigest, enabled };
          if (implementation.toLowerCase() !== adapter.implementation.toLowerCase() || beneficiary.toLowerCase() !== envelope.beneficiary.toLowerCase() ||
            termsDigest.toLowerCase() !== envelope.termsDigest.toLowerCase() || maximumDeveloperFeeBps !== envelope.maximumDeveloperFeeBps ||
            maximumDeveloperFeeBps > reviewed[2]) throw new LifecyclePlanningError("PROFILE_TERMS", "Registry developer terms differ from the frozen reviewed envelope");
        }
        await certifyLifecycleProfile(client, options.orchestrator, registry, id, registration, adapter, topology, envelope, block, chainId);
        const eligible = await readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "requireEligible", [registration.adapterId, id, topology.configVersion, LIFECYCLE_REQUIRED_CAPABILITIES], block);
        if (eligible.toLowerCase() !== adapter.implementation.toLowerCase() || (developerTerms !== undefined && !developerTerms.enabled)) throw new LifecyclePlanningError("INELIGIBLE_PROFILE", "Registry refuses this profile for pending source admission");
        admitted = true;
      } catch (failure) { reason = failure instanceof Error ? failure.message : String(failure); }
      return { id, registration, adapter, topology, envelope, developerTerms, protocolMaximumDeveloperFeeBps: venueKind === "uniswap-v4" ? protocolMaximumDeveloperFeeBps : undefined, admitted, reason, venueKind };
    }));
    // A required V4 cap read still rejects the invocation on failure; Abyss has no developer-fee terms.
    if (protocolMaximumDeveloperFeeBpsPromise !== undefined) await protocolMaximumDeveloperFeeBpsPromise;
    if (pinnedBlock === undefined) await assertLifecycleBlock(client, block, chainId);
    return profiles;
  });
}

async function readPoolBoundHookDeploymentDetails(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }, block: LifecycleBlock): Promise<{ deployment: PoolBoundHookDeployment; parameters: PoolBoundHookParametersV1 }> {
  const { client, plan, marketIndex } = options;
  const market = plan.markets[marketIndex];
  if (market === undefined || market.configVersion !== 5) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market index must select reviewed pool-bound config version 5");
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID");
  if (chainId !== plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed plan");
  const registry = await readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "registry", [], block);
  const [authority, registration] = await Promise.all([
    readLifecycleContract<Address>(client, registry, lifecycleRegistryAbi, "core", [], block),
    readLifecycleContract<ProfileRegistrationV1>(client, registry, lifecycleRegistryAbi, "profile", [market.profileId], block),
  ]);
  if (authority.toLowerCase() !== plan.orchestrator.toLowerCase()) throw new LifecyclePlanningError("REGISTRY_BINDING", "Registry is not bound to this lifecycle core");
  const adapter = await readLifecycleContract<AdapterRegistrationV1>(client, registry, lifecycleRegistryAbi, "adapter", [registration.adapterId], block);
  if (registration.adapterId.toLowerCase() !== market.adapterId.toLowerCase()) throw new LifecyclePlanningError("INVALID_BOUND_MARKET", "Market adapter differs from the profile's immutable registration");
  const [recorded, envelope, [implementation, beneficiary, maximumDeveloperFeeBps, termsDigest, enabled], protocolMaximumDeveloperFeeBps, token] = await Promise.all([
    readLifecycleProfileTopology(client, registry, market.profileId, block),
    readLifecycleContract<LaunchEnvelopeV2>(client, registry, lifecycleRegistryAbi, "profileEnvelope", [market.profileId], block),
    readLifecycleContract<readonly [Address, Address, number, Hex, boolean]>(client, registry, lifecycleRegistryAbi, "developerTerms", [market.profileId], block),
    readLifecycleContract<number>(client, registry, lifecycleRegistryAbi, "protocolMaximumDeveloperFeeBps", [], block),
    readLifecycleContract<Address>(client, plan.orchestrator, launchLifecycleAbi, "predictToken", [plan], block),
  ]);
  const { boundGraph } = await certifyLifecycleProfile(client, plan.orchestrator, registry, market.profileId, registration, adapter, recorded, envelope, block, chainId);
  if (boundGraph === undefined) throw new LifecyclePlanningError("UNCERTIFIED_TOPOLOGY", "Market does not have a certified pool-bound deployer graph");
  const config = decodePoolBoundV4LifecycleMarketConfig(market.config);
  validateV4LifecycleMarket({ market, config, token, profile: {
    id: market.profileId, registration, adapter, topology: recorded, envelope,
    developerTerms: { adapter: implementation, beneficiary, maximumDeveloperFeeBps, termsDigest, enabled },
    protocolMaximumDeveloperFeeBps, venueKind: "uniswap-v4", admitted: enabled,
  } });
  await validateV4LifecycleOracle({ client, envelope, oracleConfigId: config.oracleConfigId, block });
  const expected: PoolBoundHookParametersV1 = {
    poolManager: boundGraph.manager, registrar: adapter.implementation, oracleFactory: boundGraph.oracleFactory, core: plan.orchestrator,
    liquidityLocker: boundGraph.locker, token, quoteCurrency: market.quoteAsset, lpFeePips: config.lpFeePips, tickSpacing: config.tickSpacing,
    sqrtPriceX96: config.sqrtPriceX96, hookFeePips: config.hookFeePips, feeMode: config.feeMode, protocolFeeDenominator: config.protocolFeeDenominator,
    treasury: config.treasury, externalLiquidityDisabled: config.externalLiquidityDisabled, oracleConfigId: config.oracleConfigId,
    marketCommitment: hashPoolBoundV4MarketCommitment({ chainId, core: plan.orchestrator, registrar: adapter.implementation, token, market }),
    expectedPositionCount: config.positions.length,
  };
  const [[parameters, parameterSalt], [deployer, initCodeHash, salt, predictedHook], remoteInitCodeHash, remotePrediction] = await Promise.all([
    readLifecycleContract<readonly [PoolBoundHookParametersV1, Hex]>(client, boundGraph.collectorFactory, poolFeeCollectorFactoryV1Abi, "poolBoundHookParameters", [adapter.implementation, token, market], block),
    readLifecycleContract<readonly [Address, Hex, Hex, Address]>(client, adapter.implementation, poolMarketAdapterV1Abi, "hookDeploymentMetadata", [token, market], block),
    readLifecycleContract<Hex>(client, boundGraph.deployer, poolHookDeployerV1Abi, "initCodeHash", [expected], block),
    readLifecycleContract<Address>(client, boundGraph.deployer, poolHookDeployerV1Abi, "predict", [expected, config.hookSalt], block),
  ]);
  const localInitCodeHash = poolBoundHookInitCodeHash(boundGraph.creationCode, expected);
  const localPrediction = predictPoolBoundHookAddress({ deployer: boundGraph.deployer, initCodeHash: localInitCodeHash, salt: config.hookSalt });
  if (encodePoolBoundHookParameters(parameters).toLowerCase() !== encodePoolBoundHookParameters(expected).toLowerCase() || parameterSalt.toLowerCase() !== config.hookSalt.toLowerCase() || salt.toLowerCase() !== config.hookSalt.toLowerCase() || deployer.toLowerCase() !== boundGraph.deployer.toLowerCase() || initCodeHash.toLowerCase() !== localInitCodeHash.toLowerCase() || remoteInitCodeHash.toLowerCase() !== localInitCodeHash.toLowerCase() || predictedHook.toLowerCase() !== localPrediction.toLowerCase() || remotePrediction.toLowerCase() !== localPrediction.toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Bound hook metadata differs from the exact certified constructor economics, factory, initcode, salt or CREATE2 prediction");
  const hookCode = rpcHex(await lifecyclePinnedRpc(client, "eth_getCode", [predictedHook, toHex(block.number)], block), "bound hook code");
  if (hookCode !== "0x") {
    const [deployedCodeHash, dependencies, requiredFlags, allFlags, actualPoolId, deploymentConfigHash, marketCommitment, opening, positions] = await Promise.all([
      readLifecycleContract<Hex>(client, deployer, poolHookDeployerV1Abi, "deployedCodeHash", [predictedHook], block),
      Promise.all((["poolManager", "registrar", "oracleFactory", "core", "liquidityLocker", "token"] as const).map((getter) => readLifecycleContract<Address>(client, predictedHook, fixedFeePoolHookV1Abi, getter, [], block))),
      readLifecycleContract<bigint>(client, predictedHook, fixedFeePoolHookV1Abi, "REQUIRED_HOOK_FLAGS", [], block),
      readLifecycleContract<bigint>(client, predictedHook, fixedFeePoolHookV1Abi, "ALL_HOOK_MASK", [], block),
      readLifecycleContract<Hex>(client, predictedHook, fixedFeePoolHookV1Abi, "boundPoolId", [], block),
      readLifecycleContract<Hex>(client, predictedHook, fixedFeePoolHookV1Abi, "deploymentConfigHash", [], block),
      readLifecycleContract<Hex>(client, predictedHook, fixedFeePoolHookV1Abi, "marketCommitment", [], block),
      readLifecycleContract<bigint>(client, predictedHook, fixedFeePoolHookV1Abi, "openingSqrtPriceX96", [], block),
      readLifecycleContract<number>(client, predictedHook, fixedFeePoolHookV1Abi, "expectedPositionCount", [], block),
    ]);
    if ((hookCode.length - 2) / 2 > 24576 || deployedCodeHash === zeroHash || deployedCodeHash.toLowerCase() !== keccak256(hookCode).toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook lacks this exact typed deployer's bounded runtime-code provenance");
    for (const [index, expectedAddress] of [expected.poolManager, expected.registrar, expected.oracleFactory, expected.core, expected.liquidityLocker, expected.token].entries()) {
      if (dependencies[index]?.toLowerCase() !== expectedAddress.toLowerCase()) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook immutable dependency graph differs from the committed constructor");
    }
    if (requiredFlags !== 0x1afcn || allFlags !== 0x3fffn) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing bound hook callback declarations differ from the reviewed envelope");
    const [currency0, currency1] = BigInt(token) < BigInt(market.quoteAsset) ? [token, market.quoteAsset] : [market.quoteAsset, token];
    const expectedPoolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [currency0, currency1, config.lpFeePips, config.tickSpacing, predictedHook]));
    if (actualPoolId.toLowerCase() !== expectedPoolId.toLowerCase() || deploymentConfigHash.toLowerCase() !== keccak256(encodePoolBoundHookParameters(expected)).toLowerCase() || marketCommitment.toLowerCase() !== expected.marketCommitment.toLowerCase() || opening !== expected.sqrtPriceX96 || positions !== expected.expectedPositionCount) throw new LifecyclePlanningError("HOOK_DEPLOYMENT_CHANGED", "Existing hook key, economic commitment or immutable opening geometry changed");
  }
  return { deployment: { deployer, initCodeHash, salt, predictedHook }, parameters: expected };
}

/** Works with an unmined candidate salt and after preparation; never accepts a caller-selected root. */
export async function readPoolBoundHookDeployment(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }, pinnedBlock?: LifecycleBlock): Promise<PoolBoundHookDeployment> {
  const commitment = hashLaunchPlan(options.plan);
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  return withLifecycleReadClient(options.client, async (client) => {
    const { deployment } = await readPoolBoundHookDeploymentDetails({ ...options, client }, block);
    if (hashLaunchPlan(options.plan) !== commitment) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed while reading hook deployment metadata");
    if (pinnedBlock === undefined) await assertLifecycleBlock(client, block, options.plan.chainId);
    return deployment;
  });
}

/** Optional permissionless predeployment calldata; no token deployment, pool registration or wallet broadcast. */
export async function buildPoolBoundHookDeploymentTransaction(options: { client: LifecycleRpcClient; plan: LaunchPlanV1; marketIndex: number }): Promise<{ to: Address; data: Hex; value: bigint; deployment: PoolBoundHookDeployment }> {
  const commitment = hashLaunchPlan(options.plan);
  const block = await readLifecycleBlock(options.client);
  return withLifecycleReadClient(options.client, async (client) => {
    const { deployment, parameters } = await readPoolBoundHookDeploymentDetails({ ...options, client }, block);
    if (!hasLifecycleV4HookPermissions(deployment.predictedHook)) throw new LifecyclePlanningError("INVALID_HOOK_BITS", "Finalize a salt with the exact lifecycle hook permissions before predeployment");
    if (hashLaunchPlan(options.plan) !== commitment) throw new LifecyclePlanningError("PLAN_MUTATED", "Economic plan changed while constructing hook deployment calldata");
    await assertLifecycleBlock(client, block, options.plan.chainId);
    return { to: deployment.deployer, data: encodeFunctionData({ abi: poolHookDeployerV1Abi, functionName: "deploy", args: [parameters, deployment.salt] }), value: 0n, deployment };
  });
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
  const [receiptValue, transactionValue] = await Promise.all([
    lifecycleRpc(options.client, "eth_getTransactionReceipt", [effectiveHash]),
    lifecycleRpc(options.client, "eth_getTransactionByHash", [effectiveHash]),
  ]);
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
  const block = pinnedBlock ?? await readLifecycleBlock(options.client);
  return withLifecycleReadClient(options.client, (client) => readLaunchProgressAtBlock(options, client, block, pinnedBlock === undefined));
}

async function readLaunchProgressAtBlock(options: ReadLaunchProgressOptions, client: LifecycleRpcClient, block: LifecycleBlock, checkBlock: boolean): Promise<CanonicalLaunchProgress> {
  const { planned } = options;
  const confirmationDepth = options.confirmations ?? planned.confirmations;
  if (!Number.isSafeInteger(confirmationDepth) || confirmationDepth < 1) throw new LifecyclePlanningError("INVALID_CONFIRMATIONS", "Confirmation depth must be a positive integer");
  const confirmedNumber = block.number >= BigInt(confirmationDepth - 1) ? block.number - BigInt(confirmationDepth - 1) : 0n;
  const confirmedBlock = confirmedNumber === block.number ? block : await readLifecycleBlock(client, toHex(confirmedNumber));
  const chainId = rpcQuantity(await lifecycleRpc(client, "eth_chainId"), "chain ID");
  if (chainId !== planned.plan.chainId) throw new LifecyclePlanningError("CHAIN_MISMATCH", "RPC chain differs from the committed launch");
  if (planned.account.toLowerCase() !== planned.plan.creator.toLowerCase()) throw new LifecyclePlanningError("ACCOUNT_MISMATCH", "Execution account must be the committed creator/payer/refund account");
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored economic plan no longer matches its commitment");
  const [head, confirmedProgress, token, confirmedNonce, headNonce, pendingNonce] = await Promise.all([
    readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], block, planned.account),
    confirmedNumber === block.number ? undefined : readLifecycleContract<LaunchProgressV1>(client, planned.plan.orchestrator, launchLifecycleAbi, "readLaunchProgress", [planned.launchId], confirmedBlock, planned.account),
    readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "predictToken", [planned.plan], block),
    lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(confirmedBlock.number)]),
    confirmedNumber === block.number ? undefined : lifecycleRpc(client, "eth_getTransactionCount", [planned.account, toHex(block.number)]),
    lifecycleRpc(client, "eth_getTransactionCount", [planned.account, "pending"]),
  ]);
  const canonical = confirmedProgress ?? head;
  if (token.toLowerCase() !== planned.predictedToken.toLowerCase()) throw new LifecyclePlanningError("TOKEN_IDENTITY", "Predicted token changed for the committed token configuration");
  for (const progress of [canonical, head]) if (progress.phase !== LifecyclePhase.None) {
    if (progress.planHash.toLowerCase() !== planned.planHash.toLowerCase() || progress.launchId.toLowerCase() !== planned.launchId.toLowerCase() || progress.creator.toLowerCase() !== planned.account.toLowerCase() || progress.nonce !== planned.plan.nonce || progress.token.toLowerCase() !== token.toLowerCase() || progress.marketCount !== planned.plan.markets.length || progress.buyCount !== planned.plan.buys.length || progress.deadline !== planned.plan.deadline) throw new LifecyclePlanningError("PLAN_REPLAY", "This creator nonce is already bound to a different economic launch");
    if (progress.mode !== (planned.mode === "atomic" ? LifecycleMode.Atomic : LifecycleMode.Staged)) throw new LifecyclePlanningError("MODE_MISMATCH", "Execution mode differs from the already recorded launch");
    if (progress.preparedMarkets > progress.marketCount || progress.phase === LifecyclePhase.Activating || (progress.phase === LifecyclePhase.Ready && progress.preparedMarkets !== progress.marketCount)) throw new LifecyclePlanningError("INVALID_PROGRESS", "Canonical progress violates the committed ordered state machine");
  }
  const confirmedAccountNonce = rpcQuantity(confirmedNonce, "confirmed account nonce");
  const headAccountNonce = headNonce === undefined ? confirmedAccountNonce : rpcQuantity(headNonce, "head account nonce");
  const pendingAccountNonce = rpcQuantity(pendingNonce, "pending account nonce");
  const progressParameters = [{ type: "tuple", components: launchProgressV1Components }] as const;
  const confirmationSafe = confirmedAccountNonce === headAccountNonce && pendingAccountNonce === headAccountNonce && keccak256(encodeAbiParameters(progressParameters, [canonical])) === keccak256(encodeAbiParameters(progressParameters, [head]));
  const receipts = await Promise.all((options.receipts ?? []).map((reference) => readReceipt({ ...reference, confirmations: Math.max(reference.confirmations ?? 1, confirmationDepth) }, { ...options, client }, block)));
  let markets: LifecycleMarketProgress[] = [];
  if (canonical.preparedMarkets > 0) {
    const directory = await readLifecycleContract<Address>(client, planned.plan.orchestrator, launchLifecycleAbi, "directory", [], confirmedBlock);
    markets = await Promise.all(Array.from({ length: canonical.preparedMarkets }, async (_, index): Promise<LifecycleMarketProgress> => {
      const [adapter, prepared] = await readLifecycleContract<readonly [Address, PreparedMarketV1]>(client, directory, lifecycleDirectoryAbi, "market", [planned.launchId, index], confirmedBlock);
      validateLifecycleMarketIdentity(prepared.identity, planned.plan, token, index);
      try {
        const live = await readLifecycleContract<MarketLiveStateV1>(client, adapter, lifecycleAdapterAbi, "readMarket", [planned.launchId, index], confirmedBlock);
        return { index, prepared, live };
      } catch (failure) {
        return { index, prepared, error: failure instanceof Error ? failure.message : String(failure) };
      }
    }));
  }
  if (checkBlock) await assertLifecycleBlock(client, block, chainId);
  if (confirmedNumber !== block.number) await assertLifecycleBlock(client, confirmedBlock, chainId);
  if (hashLaunchPlan(planned.plan).toLowerCase() !== planned.planHash.toLowerCase() || hashLaunchIdentity(planned.plan).toLowerCase() !== planned.launchId.toLowerCase()) throw new LifecyclePlanningError("PLAN_MUTATED", "Stored economic plan changed during asynchronous progress reads");
  return { canonical, head, confirmationDepth, confirmedBlockNumber: confirmedBlock.number, confirmedBlockHash: confirmedBlock.hash, confirmedAccountNonce, headAccountNonce, pendingAccountNonce, confirmationSafe, token, planHash: planned.planHash, launchId: planned.launchId, chainId, blockNumber: block.number, blockHash: block.hash, markets, receipts };
}
