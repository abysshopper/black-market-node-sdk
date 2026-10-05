import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc20-dividends-abyss", description: "Holder dividends and three canonical Abyss positions",
  tokenKind: 0, rewardMode: 2, mode: "staged",
  markets: [{ venue: "abyss", positions: 3 }], buysPerMarket: 1,
});
