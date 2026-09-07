import assert from "node:assert/strict";
import test from "node:test";

/**
 * Canonical Robinhood Chain mainnet deployment, mirroring
 * contracts/config/networks/robinhood-mainnet.json (Abyss infrastructure) and
 * contracts/deployments/launch/robinhood-mainnet-replacement-deployment-record.json
 * (launch application) in the black-market monorepo.
 */
const canonicalAbyss = {
  abyssFactory: "0xe7feF2BC860B25bbdEB6F6AB96d88bAAa77ddad7",
  abyssFeeVault: "0x19b04F2E86fFDf26510ACf25344c406240214d5F",
  abyssPoolDeployer: "0xe49Ff46f2Ca543D5504cDCF533fe84e0c95eF693",
  abyssRouter: "0xF7818c69e31bf98eFF96C721B557Bb519659CD27",
  abyssQuoter: "0xF1ff7c78605939df2d705F3E12Ac9CEB69Bcfe76",
  abyssPositionManager: "0x1b2176d4D2C7bd36227D92Ed84F1A3aE30B635bF",
  abyssPositionLocker: "0xa0d4fA31740FA0d8fc6b5b4173Da17864Eb6e888",
  abyssToken: "0x15f3385625D7e364C5a6216FBbceadf10fa90e7d",
  abyssBuybackBurnerImplementation: "0xd17F05C41FfdebB6b57b3e232c20a340906A0aAd",
  abyssBuybackBurner: "0xF6C7159e967f28C65d9Fb5b919567E04540cD2FF",
  abyssFeeRouterImplementation: "0xB35b85db23fEF3A146Fbd755D76be12F9e1eBfFC",
  abyssFeeRouter: "0x2c3B1b6fe0EDa8e10C0445567b47e66E825B34cd",
};

const canonicalLaunch = {
  launchTokenFactory: "0x7B6F6efb4536F579223423e31d9036D996bc90F0",
  launchCoordinator: "0xE98A82202D794A7836316971e7ACf61F260f8399",
  launchFactory: "0xAf3FdC499b3717EBE8aD51B66bA78Cb083552351",
  launchTemplateRegistry: "0x5C22c6e02bAC8225eed64629447868bAA5774186",
  launchModuleFactory: "0xb2D9988592eE245a36290A0992505ca0474434f2",
  launchFeeOwnerRegistry: "0xdD3756269Db20F2a60055b0FE8c101FAd12525f9",
};

const addressEnvironmentKeys = [
  ...Object.keys(canonicalLaunch).flatMap((field) => {
    const name = field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
    return [name, `VITE_${name}`, `NEXT_PUBLIC_${name}`];
  }),
  "LIQUIDATION_EXECUTOR",
  "VITE_LIQUIDATION_EXECUTOR",
  "NEXT_PUBLIC_LIQUIDATION_EXECUTOR",
];
const zeroAddress = "0x0000000000000000000000000000000000000000";
const addressesModuleUrl = new URL("../dist/addresses.js", import.meta.url);
let moduleVersion = 0;

async function withAddressEnvironment(overrides, callback) {
  const previous = new Map(addressEnvironmentKeys.map((key) => [key, process.env[key]]));

  for (const key of addressEnvironmentKeys) delete process.env[key];
  Object.assign(process.env, overrides);

  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function evaluateAddressesModule() {
  moduleVersion += 1;
  return import(`${addressesModuleUrl.href}?addresses-test=${moduleVersion}`);
}

test("Robinhood defaults use the canonical replacement Abyss deployment", async () => {
  await withAddressEnvironment({}, async () => {
    const {
      getAddresses,
      robinhoodAbyssInfrastructure,
      robinhoodLaunchApplication,
      robinhoodMainnet,
    } = await evaluateAddressesModule();
    const mainnet = getAddresses(4663);
    assert.equal(mainnet.liquidationExecutor, zeroAddress);
    assert.equal(
      robinhoodMainnet.contracts.multicall3.address,
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );

    for (const [field, expected] of Object.entries(canonicalAbyss)) {
      assert.equal(robinhoodAbyssInfrastructure[field].toLowerCase(), expected.toLowerCase());
      assert.equal(mainnet[field].toLowerCase(), expected.toLowerCase());
    }

    for (const [field, expected] of Object.entries(canonicalLaunch)) {
      assert.equal(robinhoodLaunchApplication[field].toLowerCase(), expected.toLowerCase());
      assert.equal(mainnet[field].toLowerCase(), expected.toLowerCase());
    }

    for (const chainId of [31337, 46631]) {
      const local = getAddresses(chainId);
      assert.equal(local.liquidationExecutor, zeroAddress);
      for (const field of Object.keys(canonicalLaunch)) {
        assert.equal(local[field], zeroAddress);
      }
    }
  });
});

test("launch environment overrides retain bare, VITE, and NEXT_PUBLIC precedence", async () => {
  const overrideCases = [
    {
      environment: {
        LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000001",
        VITE_LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000002",
        NEXT_PUBLIC_LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000001",
    },
    {
      environment: {
        VITE_LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000002",
        NEXT_PUBLIC_LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000002",
    },
    {
      environment: {
        NEXT_PUBLIC_LAUNCH_FEE_OWNER_REGISTRY: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000003",
    },
  ];

  for (const { environment, expected } of overrideCases) {
    await withAddressEnvironment(environment, async () => {
      const { getAddresses } = await evaluateAddressesModule();
      const mainnet = getAddresses(4663);

      assert.equal(mainnet.launchFeeOwnerRegistry, expected);
      assert.equal(
        mainnet.launchFactory.toLowerCase(),
        canonicalLaunch.launchFactory.toLowerCase(),
      );
    });
  }
});

test("liquidation executor overrides retain bare, VITE, and NEXT_PUBLIC precedence", async () => {
  const overrideCases = [
    {
      environment: {
        LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000001",
        VITE_LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000002",
        NEXT_PUBLIC_LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000001",
    },
    {
      environment: {
        VITE_LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000002",
        NEXT_PUBLIC_LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000002",
    },
    {
      environment: {
        NEXT_PUBLIC_LIQUIDATION_EXECUTOR: "0x0000000000000000000000000000000000000003",
      },
      expected: "0x0000000000000000000000000000000000000003",
    },
  ];

  for (const { environment, expected } of overrideCases) {
    await withAddressEnvironment(environment, async () => {
      const { getAddresses } = await evaluateAddressesModule();

      for (const chainId of [31337, 4663, 46631]) {
        assert.equal(getAddresses(chainId).liquidationExecutor, expected);
      }
    });
  }
});
