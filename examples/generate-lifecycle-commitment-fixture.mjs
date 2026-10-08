import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from "viem";
import { writeFile } from "node:fs/promises";

// Frozen historical config4 wire-format reference: does not import the SDK encoder under test.
// Deliberately preserves the original bytes/hash, including pre-cutover allocations.
// This vector is not an allocation-valid 0.7.0 construction or an executable launch.
const wire = "(uint256 chainId,address orchestrator,address creator,uint256 nonce,(uint8 kind,uint8 rewardMode,string name,string symbol,uint256 supply,uint256 nftUnit,string metadataURI,bytes32 salt,address inventoryRecipient,bool burnOnCancel) token,(address asset,uint256 amount,uint8 kind,address inputAsset,uint256 inputAmount,address target,bytes data)[] funding,(address asset,uint16 ownerBps,uint16 rewardsBps,uint16 burnBps)[] feeAssets,(bytes32 adapterId,bytes32 profileId,address quoteAsset,uint256 tokenBudget,uint32 configVersion,bytes config)[] markets,(uint32 marketIndex,uint256 quoteAmountIn,uint256 minTokenOut,address recipient,uint160 sqrtPriceLimitX96)[] buys,uint256 deadline,uint16 executorFeeBps) plan";
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const bytes32 = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const zero = address(0);
const plan = {
  chainId: 31337n, orchestrator: address(0xf0), creator: address(0xa0), nonce: 2n ** 192n + 17n,
  token: { kind: 1, rewardMode: 1, name: "Lifecycle commitment 🜁", symbol: "LCV", supply: 10n ** 27n,
    nftUnit: 100n * 10n ** 18n, metadataURI: "ipfs://lifecycle-vector/", salt: bytes32(0x1234), inventoryRecipient: address(0xa0), burnOnCancel: true },
  funding: [
    { asset: address(0x20), amount: 500_000_001n, kind: 0, inputAsset: address(0x20), inputAmount: 500_000_001n, target: zero, data: "0x" },
    { asset: address(0x30), amount: 10n ** 20n, kind: 1, inputAsset: address(0x30), inputAmount: 10n ** 20n, target: zero, data: "0x" },
  ],
  feeAssets: [
    { asset: address(0x10), ownerBps: 8000, rewardsBps: 0, burnBps: 2000 },
    { asset: address(0x20), ownerBps: 6000, rewardsBps: 4000, burnBps: 0 },
    { asset: address(0x30), ownerBps: 6000, rewardsBps: 4000, burnBps: 0 },
  ],
  markets: [
    { adapterId: bytes32(1), profileId: bytes32(11), quoteAsset: address(0x20), tokenBudget: 4n * 10n ** 26n, configVersion: 4,
      config: encodeAbiParameters(parseAbiParameters("(uint16,uint24,int24,uint160,uint24,uint8,uint8,address,bool,bytes32,bytes32,bytes32,address,uint16,(int24,int24,uint128,bytes32,uint256)[])"), [[4, 3000, 60, 2n ** 96n, 10000, 0, 6, address(0xa0), true, keccak256(encodeAbiParameters(parseAbiParameters("uint24,uint16"), [17, 4096])), bytes32(11), bytes32(21), address(0xd0), 250, [[60, 120, 10n ** 18n, bytes32(1), 10n ** 24n]]]]) },
    { adapterId: bytes32(2), profileId: bytes32(12), quoteAsset: address(0x30), tokenBudget: 5n * 10n ** 26n, configVersion: 1,
      config: encodeAbiParameters(parseAbiParameters("(uint8,uint24,bytes32,uint160,(int24,int24,uint128,uint256)[])"), [[3, 3000, bytes32(0x55), 2n ** 96n, [[60, 120, 10n ** 18n, 10n ** 24n]]]]) },
  ],
  buys: [
    { marketIndex: 1, quoteAmountIn: 13n * 10n ** 18n, minTokenOut: 1n, recipient: address(0xb1), sqrtPriceLimitX96: 2n ** 96n - 1n },
    { marketIndex: 0, quoteAmountIn: 20_000_000n, minTokenOut: 2n, recipient: address(0xb2), sqrtPriceLimitX96: 2n ** 96n - 1n },
    { marketIndex: 1, quoteAmountIn: 7n * 10n ** 18n, minTokenOut: 3n, recipient: address(0xb3), sqrtPriceLimitX96: 2n ** 96n - 1n },
  ],
  deadline: 2_000_000_000n, executorFeeBps: 275,
};
const domain = keccak256(stringToHex("BLACK_MARKET_LAUNCH_PLAN_V1"));
const fixture = {
  schema: "black-market.launch-lifecycle-commitment-vector.v1", description: "Portable reviewed config-4/Abyss economic wire vector, not a deployed launch. Both modes commit identical economics.",
  plan, encodedPlan: encodeAbiParameters(parseAbiParameters(wire), [plan]),
  planHash: keccak256(encodeAbiParameters(parseAbiParameters(`bytes32 domain,${wire}`), [domain, plan])),
  launchId: keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,uint256"), [plan.chainId, plan.orchestrator, plan.creator, plan.nonce])),
  domain, modes: ["atomic", "staged"],
};
const json = `${JSON.stringify(fixture, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`;
const outputs = process.argv.slice(2);
if (outputs.length === 0) process.stdout.write(json);
else {
  for (const output of outputs) await writeFile(output, json);
  console.log(JSON.stringify({ generated: outputs, planHash: fixture.planHash, launchId: fixture.launchId }));
}
