import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc404-v4", description: "ERC404 NFT units and metadata, staged pool-bound V4",
  tokenKind: 1, rewardMode: 0, mode: "staged",
  markets: [{ venue: "v4", positions: 1 }], buysPerMarket: 1,
});
