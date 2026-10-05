import { runLaunchExample } from "./launch-example.mjs";

await runLaunchExample({
  id: "erc404-abyss", description: "ERC404 NFT units and metadata, atomic canonical Abyss",
  tokenKind: 1, rewardMode: 0, mode: "atomic",
  markets: [{ venue: "abyss", positions: 1 }], buysPerMarket: 1,
});
