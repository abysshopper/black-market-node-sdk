import type { Address, Hex } from "viem";
import type {
  AdapterRegistrationV1, LaunchEnvelopeV2, ProfileRegistrationV1, ProfileTopologyV1,
} from "./schema.js";
import type { LifecycleProfile } from "./types.js";
import { fixedFeePoolHookV1CreationCode } from "./deployments/fixed-fee-pool-hook-v1-20261008.js";

export enum KnownLifecycleProfile {
  Abyss0 = "abyss-0",
  Abyss1 = "abyss-1",
  Abyss2 = "abyss-2",
  Abyss3 = "abyss-3",
  V4FixedFeePool = "v4-fixed-fee-pool",
}

export enum KnownLifecycleHook {
  FixedFeePoolV1 = "fixed-fee-pool-v1",
}

Object.freeze(KnownLifecycleProfile);
Object.freeze(KnownLifecycleHook);

/** Frozen construction metadata, not a current eligibility or execution observation. */
export type LifecycleProfilePreset = {
  readonly key: KnownLifecycleProfile;
  /** Support applies only to the frozen profile's exact version, schema and constructor graph. */
  readonly supported: boolean;
  readonly unavailableReason?: string;
  readonly profile: Omit<LifecycleProfile, "admitted" | "reason">;
  readonly boundHook?: {
    /** Constructor creation code only; append the exact per-market parameters. */
    readonly creationCode: Hex;
    readonly deployer: Address;
    readonly poolManager: Address;
    readonly oracleFactory: Address;
    readonly liquidityLocker: Address;
    readonly registrar: Address;
  };
};

/** A versioned release snapshot. Enabled fields describe that release, not live admission. */
export type LifecycleDeploymentPreset = {
  readonly chainId: bigint;
  readonly orchestrator: Address;
  readonly registry: Address;
  readonly tokenFactory: Address;
  readonly tokenFactoryCodeHash: Hex;
  readonly fundingEscrow: Address;
  readonly profiles: readonly LifecycleProfilePreset[];
  readonly provenance: {
    readonly sourceCommit: string;
    /** Final mined deployment/admission receipt block. */
    readonly deploymentBlock: bigint;
  };
};

type KnownLifecycleDeploymentIdentity = { chainId: number | bigint; orchestrator: Address };

const zeroAddress: Address = "0x0000000000000000000000000000000000000000";
const zeroHash: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

// pool-launch-v1/20261008T000141Z-e174ce6: canonical manifest.json/readback.json,
// deployment.json, admission.json and release-owned config6/V2 artifact.
const abyssAdapter = Object.freeze({
  implementation: "0x3ef760fcbbD618Ab6cB7E308e7fB39C93b9deFD0",
  codeHash: "0xf4f6afdb5ae50e96b3d1cee8a92aeb67d8f007597eb5586fb90e08fec3bb3067",
  capabilities: 123n,
  configVersion: 1,
  enabled: true,
} satisfies AdapterRegistrationV1);

const abyssRegistration = Object.freeze({
  adapterId: "0xd79e93fc12ead15de269a5b98a9e0d2205ab77422d0cb480500370babc5687da",
  configSchema: "0x324324a00058a3bfd5fbeeec8adabfaf4c592430fe78275197a82f291e1e33d7",
  dependencyDigest: "0xd602187529cf0f81122ae34d9aee89b65ec308d8d836ee24cba407e20e702f62",
  venue: "0xe7feF2BC860B25bbdEB6F6AB96d88bAAa77ddad7",
  factory: "0xe7feF2BC860B25bbdEB6F6AB96d88bAAa77ddad7",
  hook: zeroAddress,
  capabilities: 123n,
  enabled: true,
} satisfies ProfileRegistrationV1);

const abyssTopology = Object.freeze({
  hookTopology: 0,
  configVersion: 1,
  hookDeployer: zeroAddress,
  hookCreationCodeHash: zeroHash,
} satisfies ProfileTopologyV1);

function abyssPreset(key: KnownLifecycleProfile, id: Hex): LifecycleProfilePreset {
  // Abyss economic version 0 has no reviewed V4 envelope or developer-fee terms.
  return Object.freeze({
    key,
    supported: true,
    profile: Object.freeze({ id, registration: abyssRegistration, adapter: abyssAdapter, topology: abyssTopology, venueKind: "abyss" }),
  });
}

const fixedFeePoolEnvelope = Object.freeze({
  artifactDigest: "0x11c4c7b1f265ed708b7d53ab828c89d237ca821333daa808f1913986c6f8f1ab",
  reviewManifestDigest: "0x8fde077c6cfd39da6c8f16c56f35918c9979a9712ae86f1a43b94caf9487d9a4",
  configBoundsDigest: "0x72e0b2d542556d472a47f9c38b2c91079c72793af847dee77933f0eca203129d",
  termsDigest: "0xf2503b91eeec87f95c4f5e47df517a143422c766528c403ea44bdbd9b40df10e",
  topology: 2,
  configVersion: 6,
  economicVersion: 3,
  capabilities: 123n,
  flags: 0n,
  callbackFlags: 0x1afc,
  callbackMask: 0x3fff,
  protocolTreasury: "0x961981916AB6575C3af3eeCecbf6A3b7Fad7C9e1",
  protocolFeeDenominator: 6,
  beneficiary: "0x7cb44b8693b3C350A2BcD4b681aF85365aa27783",
  maximumDeveloperFeeBps: 0,
  bounds: Object.freeze({
    minimumTickSpacing: 1,
    maximumTickSpacing: 32767,
    maximumPositions: 32,
    maximumOracleCardinality: 4096,
    feeModeFlags: 3,
  }),
  graph: Object.freeze({
    manager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    hookRoot: zeroAddress,
    oracleFactory: "0xe7feF2BC860B25bbdEB6F6AB96d88bAAa77ddad7",
    locker: "0x28B84e5B9E905493E24986C91Ef109C752505B58",
    collectorFactory: "0x43b394fE6865EE6797c60FCCcd33D7D765214b52",
    collectorDeployer: "0x1d9Aa696568F6D4b96914C7e35DEF33781826A48",
    hookDeployer: "0x1Df787Cc099B047A606059Ac80A8296779266f9e",
    coreCodeHash: "0x9fb8f46c3b980b9db25dfdb487a69a308a86be145860269b4036a4e74480787b",
    managerCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
    hookRuntimeCodeHash: zeroHash,
    oracleFactoryCodeHash: "0x974fb5c72d91ccb99f1eb4679a5d4432c82bbaa0906b1c2917ec4da3499b7b98",
    lockerCodeHash: "0x0799a2fd8b8d4e80b796a46b7505ee50dbfe80b1c7aa6a48b7006673d1d55be1",
    collectorFactoryCodeHash: "0x5f82ad8883286012bbeffea84eec6fca9be9d2331b6c94c0137a4f4c6dacc2e2",
    collectorDeployerCodeHash: "0xdbe8146da63c4445974b23b983a6ff89271f879117bc366ded7519458d1dc60a",
    hookDeployerCodeHash: "0x649bf5e7306ca628986f71905becf8706f9bdd780245bebc641ed5cfa071b3bc",
    hookCreationCodeHash: "0x11c4c7b1f265ed708b7d53ab828c89d237ca821333daa808f1913986c6f8f1ab",
    codeChunk0: "0x67E8B145AeB0C01F7F3adf512a5337FB2AD8ccc2",
    codeChunk0Hash: "0xe5f56287276954b21f4211cabf2d9c251aae68836c5fa86ce68091ffccdee26b",
    codeChunk1: "0x0f674bD3F587c943fd165A6D2E06b95929dA40a2",
    codeChunk1Hash: "0x76efd61e1a109a85140ce3473c43694a83f490eaac54d18673c17872a5262a47",
    sharedHookSalt: zeroHash,
  }),
} satisfies LaunchEnvelopeV2);

const fixedFeePoolAdapter = Object.freeze({
  implementation: "0xb334b44509a5237a39cE364c159913F14b6D1186",
  codeHash: "0xa7e90d9d6a91344611dec01a10cf3876108d14fbfe8b950a39d1523cc31f893f",
  capabilities: 123n,
  configVersion: 6,
  enabled: true,
} satisfies AdapterRegistrationV1);

const fixedFeePoolPreset: LifecycleProfilePreset = Object.freeze({
  key: KnownLifecycleProfile.V4FixedFeePool,
  supported: true,
  profile: Object.freeze({
    id: "0xf18140c2fb66a4202a0f22d62d6288bf7976db108de5381e5497aaed332a06f8",
    registration: Object.freeze({
      adapterId: "0xe10c1f6655db6e06817384a2283c2e181a7d9cf21c5bee04fc6f9f073ab24587",
      configSchema: "0x51c5ca14c40012f78425cd1afb1ea77980da3fed0490a00911a8a4ed34792045",
      dependencyDigest: "0x2576d8944ef64f3c2eae30229b118597c4dc277dd5b1b24d00413220c7cfc5a8",
      venue: fixedFeePoolEnvelope.graph.manager,
      factory: zeroAddress,
      hook: zeroAddress,
      capabilities: 123n,
      enabled: true,
    }),
    adapter: fixedFeePoolAdapter,
    topology: Object.freeze({
      hookTopology: 2,
      configVersion: 6,
      hookDeployer: fixedFeePoolEnvelope.graph.hookDeployer,
      hookCreationCodeHash: fixedFeePoolEnvelope.graph.hookCreationCodeHash,
    }),
    venueKind: "uniswap-v4",
    envelope: fixedFeePoolEnvelope,
    developerTerms: Object.freeze({
      adapter: fixedFeePoolAdapter.implementation,
      beneficiary: fixedFeePoolEnvelope.beneficiary,
      maximumDeveloperFeeBps: fixedFeePoolEnvelope.maximumDeveloperFeeBps,
      termsDigest: fixedFeePoolEnvelope.termsDigest,
      enabled: true,
    }),
    protocolMaximumDeveloperFeeBps: 2400,
  }),
  boundHook: Object.freeze({
    creationCode: fixedFeePoolHookV1CreationCode,
    deployer: fixedFeePoolEnvelope.graph.hookDeployer,
    poolManager: fixedFeePoolEnvelope.graph.manager,
    oracleFactory: fixedFeePoolEnvelope.graph.oracleFactory,
    liquidityLocker: fixedFeePoolEnvelope.graph.locker,
    registrar: fixedFeePoolAdapter.implementation,
  }),
});

const knownDeployment: LifecycleDeploymentPreset = Object.freeze({
  chainId: 4663n,
  orchestrator: "0x91560876033d568d25CDe98C78c33ff8FC43962c",
  registry: "0xB2B0f9F36617810D67b8fC175153Aa10024C1358",
  tokenFactory: "0xd3cE64E49224a9a96075633f63761FE6BE22FE30",
  tokenFactoryCodeHash: "0x6bbbdfe93ec615b7f1e70bac5e69aa890eba5e5f248f25e7022e866b4064d541",
  fundingEscrow: "0x7bc77946CeF52A178583FCe1EEB7751983cEC703",
  profiles: Object.freeze([
    abyssPreset(KnownLifecycleProfile.Abyss0, "0x49b2ed65e2021247951193dd2c671b40867b6e064af65a2d98a70f57556412fc"),
    abyssPreset(KnownLifecycleProfile.Abyss1, "0x2f6f494f8810473b3c0ac6b03b1a1353d067ffa5c86d3cba16b04c6b61f73c05"),
    abyssPreset(KnownLifecycleProfile.Abyss2, "0x49b3bd30fe302526d7799f2ef15f3b2b261b5c44e075aa48b98c6b37148b7d59"),
    abyssPreset(KnownLifecycleProfile.Abyss3, "0xe1bd95e086469e6afd9791ccc957e4d22b735012cb3db4a747f703673c62c306"),
    fixedFeePoolPreset,
  ]),
  provenance: Object.freeze({ sourceCommit: "e174ce695c7010f50ca9211b07b9f178c990beac", deploymentBlock: 82880546n }),
});

const knownChainNumber = Number(knownDeployment.chainId);
const knownCore = knownDeployment.orchestrator.toLowerCase();
const noProfiles: readonly LifecycleProfilePreset[] = Object.freeze([]);

/** Local lookup only. Unknown deployments remain available to explicit live discovery. */
export function getKnownLifecycleDeployment(options: KnownLifecycleDeploymentIdentity): LifecycleDeploymentPreset | undefined {
  if ((options.chainId !== knownDeployment.chainId && options.chainId !== knownChainNumber) ||
      options.orchestrator.toLowerCase() !== knownCore) return undefined;
  return knownDeployment;
}

/** Resolve a documented enum key or release-owned ID, without replacement metadata. */
export function getKnownLifecycleProfile(options: KnownLifecycleDeploymentIdentity &
  ({ key: KnownLifecycleProfile; profileId?: never } | { profileId: Hex; key?: never })): LifecycleProfilePreset | undefined {
  const deployment = getKnownLifecycleDeployment(options);
  if (deployment === undefined) return undefined;
  if (options.key !== undefined) {
    for (const preset of deployment.profiles) if (preset.key === options.key) return preset;
  } else {
    const id = options.profileId.toLowerCase();
    for (const preset of deployment.profiles) if (preset.profile.id === id) return preset;
  }
  return undefined;
}

/** Stable, frozen release order: Abyss variants 0 through 3, then the pool-bound V4 profile. */
export function listKnownLifecycleProfiles(options: KnownLifecycleDeploymentIdentity): readonly LifecycleProfilePreset[] {
  return getKnownLifecycleDeployment(options)?.profiles ?? noProfiles;
}
