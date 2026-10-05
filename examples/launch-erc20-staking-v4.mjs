import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc20-staking-v4", description: "Staking rewards, two V4 positions and two ordered opening buys",
  tokenKind: 0, rewardMode: 1, mode: "staged",
  markets: [{ venue: "v4", positions: 2 }], buysPerMarket: 2,
});
