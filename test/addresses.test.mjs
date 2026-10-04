import assert from "node:assert/strict";
import test from "node:test";

const launchFields = ["launchOrchestrator", "launchImplementationRegistry", "launchFeeOwnerRegistry"];

const addressEnvironmentKeys = [
  ...launchFields.flatMap((field) => {
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
