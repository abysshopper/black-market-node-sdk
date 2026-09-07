import assert from "node:assert/strict";
import test from "node:test";
import {
  addresses,
  AUCTION_QUOTE_OPTIONS,
  AUCTION_SUPPLY,
  AUCTION_SUPPLY_WHOLE,
  chains,
  createProtocolPublicClient,
  createProtocolWalletClient,
  getAddresses,
  isSupportedChainId,
  robinhoodMainnet,
  workbenchChain,
} from "../dist/index.js";

test("chain registry covers exactly the three supported chain IDs", () => {
  assert.deepEqual(Object.keys(chains).map(Number).sort((a, b) => a - b), [4663, 31337, 46631]);
  assert.equal(chains[4663], robinhoodMainnet);
  assert.equal(chains[46631], workbenchChain);
  assert.equal(chains[31337].id, 31337);

  assert.equal(isSupportedChainId(4663), true);
  assert.equal(isSupportedChainId(46631), true);
  assert.equal(isSupportedChainId(31337), true);
  assert.equal(isSupportedChainId(1), false);
  assert.equal(isSupportedChainId(4664), false);
});

test("getAddresses defaults to the workbench chain and returns per-chain maps", () => {
  assert.equal(getAddresses(), addresses[46631]);
  assert.equal(getAddresses(4663), addresses[4663]);
  assert.equal(getAddresses(31337), addresses[31337]);
  assert.notEqual(getAddresses(4663), getAddresses(46631));
});

test("public client factory binds the requested chain without network access", () => {
  const mainnet = createProtocolPublicClient({ chainId: 4663 });
  assert.equal(mainnet.chain.id, 4663);
  assert.equal(mainnet.chain.name, "Robinhood Chain");

  // Unknown/absent chain IDs fall back to the local foundry chain.
  const fallback = createProtocolPublicClient();
  assert.equal(fallback.chain.id, 31337);

  const workbench = createProtocolPublicClient({ chainId: 46631, rpcUrl: "http://127.0.0.1:9999" });
  assert.equal(workbench.chain.id, 46631);
});

test("wallet client factory derives the account address from the private key", () => {
  // Hardhat/Anvil account #0 — never a real key.
  const wallet = createProtocolWalletClient({
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    chainId: 4663,
  });
  assert.equal(wallet.account.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  assert.equal(wallet.chain.id, 4663);
});

test("auction supply constants agree with each other", () => {
  assert.equal(AUCTION_SUPPLY_WHOLE, 1_000_000_000);
  assert.equal(AUCTION_SUPPLY, BigInt(AUCTION_SUPPLY_WHOLE) * 10n ** 18n);
});

test("quote catalog is unique, checksummed, and flags only USDG as usdPeg", () => {
  const ids = AUCTION_QUOTE_OPTIONS.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.includes("ETH"));
  assert(ids.includes("WETH"));
  assert(ids.includes("USDG"));

  const addressesSeen = new Set();
  for (const option of AUCTION_QUOTE_OPTIONS) {
    assert.equal(option.symbol, option.id);
    assert.equal(typeof option.name, "string");
    assert(option.name.length > 0);
    assert([6, 18].includes(option.decimals));
    const lower = option.address.toLowerCase();
    assert.equal(addressesSeen.has(lower), false);
    addressesSeen.add(lower);
  }

  // Native ETH is the only entry represented by the zero address.
  const zeroEntries = AUCTION_QUOTE_OPTIONS.filter(
    ({ address }) => address === "0x0000000000000000000000000000000000000000",
  );
  assert.deepEqual(zeroEntries.map(({ id }) => id), ["ETH"]);

  const usdPegged = AUCTION_QUOTE_OPTIONS.filter(({ usdPeg }) => usdPeg);
  assert.deepEqual(usdPegged.map(({ id }) => id), ["USDG"]);
  assert.equal(usdPegged[0].decimals, 6);
});
