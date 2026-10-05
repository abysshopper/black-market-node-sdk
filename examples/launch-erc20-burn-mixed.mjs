import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc20-burn-mixed", description: "Burn policy, dual-fee V4 and Abyss markets for one token",
  tokenKind: 0, rewardMode: 0, mode: "staged", burnBps: 3000,
  markets: [{ venue: "v4", positions: 2, feeMode: 1 }, { venue: "abyss", positions: 1 }], buysPerMarket: 1,
});
