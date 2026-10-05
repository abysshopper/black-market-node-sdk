import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc20-v4-basic", description: "ERC20, one pool-bound V4 position, atomic opening",
  tokenKind: 0, rewardMode: 0, mode: "atomic",
  markets: [{ venue: "v4", positions: 1 }], buysPerMarket: 1,
});
