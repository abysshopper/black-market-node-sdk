import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc404-dividends-mixed", description: "ERC404 holder dividends, both venues and five permanent positions",
  tokenKind: 1, rewardMode: 2, mode: "staged",
  markets: [{ venue: "v4", positions: 2 }, { venue: "abyss", positions: 3 }], buysPerMarket: 1,
});
