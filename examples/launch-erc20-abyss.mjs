import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc20-abyss-basic", description: "ERC20, one canonical Abyss position, atomic opening",
  tokenKind: 0, rewardMode: 0, mode: "atomic",
  markets: [{ venue: "abyss", positions: 1 }], buysPerMarket: 1,
});
