import assert from "node:assert/strict";
import { isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getAddresses, LaunchApiClient } from "../../dist/index.js";

export function createLaunchApiTestContext({ signed = false } = {}) {
  const configuredUrl = process.env.LAUNCH_API_TEST_URL;
  assert.ok(configuredUrl, "Set LAUNCH_API_TEST_URL to a running abyss-api service with launch sessions and application storage configured.");
  const url = new URL(configuredUrl);
  assert.ok(["http:", "https:"].includes(url.protocol), "LAUNCH_API_TEST_URL must be an HTTP(S) service URL.");
  assert.equal(url.username + url.password, "", "Do not embed credentials in LAUNCH_API_TEST_URL.");
  assert.equal(url.pathname, "/", "LAUNCH_API_TEST_URL must be the service root, not an API route.");
  assert.equal(url.search + url.hash, "", "LAUNCH_API_TEST_URL must not contain a query or fragment.");
  const chainId = Number(process.env.LAUNCH_API_TEST_CHAIN_ID ?? "4663");
  assert.ok(Number.isSafeInteger(chainId) && chainId > 0, "LAUNCH_API_TEST_CHAIN_ID must be a positive safe integer.");
  const orchestrator = process.env.LAUNCH_API_TEST_ORCHESTRATOR ?? getAddresses(4663).launchOrchestrator;
  assert.ok(isAddress(orchestrator) && orchestrator.toLowerCase() !== zeroAddress, "LAUNCH_API_TEST_ORCHESTRATOR must be a nonzero EVM address.");
  let account;
  if (signed) {
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Signed metadata tests write application storage: use an owned disposable loopback test service, never production.");
    const key = process.env.LAUNCH_API_TEST_PRIVATE_KEY;
    assert.ok(key && /^0x[\da-fA-F]{64}$/.test(key), "Set LAUNCH_API_TEST_PRIVATE_KEY explicitly to a disposable test EOA key for test:api:write.");
    account = privateKeyToAccount(key);
  }
  const api = new LaunchApiClient({
    baseUrl: url.href,
    retries: 1,
    // Actual network fetch, bounded so an unreachable configured prerequisite fails promptly.
    fetch: (input, init) => globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
  });
  return { api, chainId, orchestrator, account };
}
