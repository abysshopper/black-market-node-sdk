import { type Address, zeroAddress } from "viem";

/** Fixed supply used by Atomic launches. */
export const AUCTION_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const AUCTION_SUPPLY_WHOLE = 1_000_000_000;


export const ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
export const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
export const ROBINHOOD_ABYSS = "0x15f3385625D7e364C5a6216FBbceadf10fa90e7d" as Address;
export const ROBINHOOD_AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" as Address;
export const ROBINHOOD_AMD = "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" as Address;
export const ROBINHOOD_AMZN = "0x12f190a9F9d7D37a250758b26824B97CE941bF54" as Address;
export const ROBINHOOD_ASML = "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA" as Address;
export const ROBINHOOD_BABA = "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4" as Address;
export const ROBINHOOD_CLSK = "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3" as Address;
export const ROBINHOOD_COIN = "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" as Address;
export const ROBINHOOD_CRCL = "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5" as Address;
export const ROBINHOOD_CRWV = "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3" as Address;
export const ROBINHOOD_DELL = "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd" as Address;
export const ROBINHOOD_EWY = "0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc" as Address;
export const ROBINHOOD_GME = "0x1b0E319c6A659F002271B69dB8A7df2F911c153E" as Address;
export const ROBINHOOD_GOOGL = "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" as Address;
export const ROBINHOOD_INTC = "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" as Address;
export const ROBINHOOD_IONQ = "0x558378E000D634A36593E338eBacdd6207640EfE" as Address;
export const ROBINHOOD_META = "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" as Address;
export const ROBINHOOD_MSFT = "0xe93237C50D904957Cf27E7B1133b510C669c2e74" as Address;
export const ROBINHOOD_MSTR = "0xec262a75e413fAfD0dF80480274532C79D42da09" as Address;
export const ROBINHOOD_MU = "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" as Address;
export const ROBINHOOD_NBIS = "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931" as Address;
export const ROBINHOOD_NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
export const ROBINHOOD_ORCL = "0xb0992820E760d836549ba69BC7598b4af75dEE03" as Address;
export const ROBINHOOD_PLTR = "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" as Address;
export const ROBINHOOD_QQQ = "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" as Address;
export const ROBINHOOD_RGTI = "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba" as Address;
export const ROBINHOOD_RKLB = "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2" as Address;
export const ROBINHOOD_SGOV = "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5" as Address;
export const ROBINHOOD_SLV = "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f" as Address;
export const ROBINHOOD_SNDK = "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" as Address;
export const ROBINHOOD_SPCX = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" as Address;
export const ROBINHOOD_SPY = "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" as Address;
export const ROBINHOOD_TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" as Address;
export const ROBINHOOD_TSM = "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA" as Address;
export const ROBINHOOD_USAR = "0xd917B029C761D264c6A312BBbcDA868658eF86a6" as Address;
export const ROBINHOOD_USO = "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344" as Address;

export type AuctionQuoteId = string;

export type AuctionQuoteOption = {
  id: AuctionQuoteId;
  symbol: string;
  /** Contract address; native ETH is represented by the zero address. */
  address: Address;
  decimals: number;
  /** UI-only: treat quote as $1 when labeling opening FDV. Not an on-chain flag. */
  /** Human-readable asset name used for search and display. */
  name: string;
  usdPeg: boolean;
};

function rwa(id: AuctionQuoteId, name: string, address: Address): AuctionQuoteOption {
  return { id, symbol: id, name, address, decimals: 18, usdPeg: false };
}

/** Supported paired assets for Atomic launches: native ETH, wrapped WETH, USDG, then catalog stocks. */
export const AUCTION_QUOTE_OPTIONS: AuctionQuoteOption[] = [
  { id: "ETH", symbol: "ETH", name: "Ether", address: zeroAddress, decimals: 18, usdPeg: false },
  { id: "WETH", symbol: "WETH", name: "Wrapped Ether", address: ROBINHOOD_WETH, decimals: 18, usdPeg: false },
  { id: "USDG", symbol: "USDG", name: "Global Dollar", address: ROBINHOOD_USDG, decimals: 6, usdPeg: true },
  { id: "ABYSS", symbol: "ABYSS", name: "Abyss", address: ROBINHOOD_ABYSS, decimals: 18, usdPeg: false },
  rwa("AAPL", "Apple", ROBINHOOD_AAPL),
  rwa("AMD", "Advanced Micro Devices", ROBINHOOD_AMD),
  rwa("AMZN", "Amazon", ROBINHOOD_AMZN),
  rwa("ASML", "ASML Holding", ROBINHOOD_ASML),
  rwa("BABA", "Alibaba", ROBINHOOD_BABA),
  rwa("CLSK", "CleanSpark", ROBINHOOD_CLSK),
  rwa("COIN", "Coinbase", ROBINHOOD_COIN),
  rwa("CRCL", "Circle", ROBINHOOD_CRCL),
  rwa("CRWV", "CoreWeave", ROBINHOOD_CRWV),
  rwa("DELL", "Dell", ROBINHOOD_DELL),
  rwa("EWY", "MSCI South Korea", ROBINHOOD_EWY),
  rwa("GME", "GameStop", ROBINHOOD_GME),
  rwa("GOOGL", "Alphabet", ROBINHOOD_GOOGL),
  rwa("INTC", "Intel", ROBINHOOD_INTC),
  rwa("IONQ", "IonQ", ROBINHOOD_IONQ),
  rwa("META", "Meta", ROBINHOOD_META),
  rwa("MSFT", "Microsoft", ROBINHOOD_MSFT),
  rwa("MSTR", "Strategy", ROBINHOOD_MSTR),
  rwa("MU", "Micron", ROBINHOOD_MU),
  rwa("NBIS", "Nebius", ROBINHOOD_NBIS),
  rwa("NVDA", "NVIDIA", ROBINHOOD_NVDA),
  rwa("ORCL", "Oracle", ROBINHOOD_ORCL),
  rwa("PLTR", "Palantir", ROBINHOOD_PLTR),
  rwa("QQQ", "Nasdaq-100", ROBINHOOD_QQQ),
  rwa("RGTI", "Rigetti", ROBINHOOD_RGTI),
  rwa("RKLB", "Rocket Lab", ROBINHOOD_RKLB),
  rwa("SGOV", "T-Bills", ROBINHOOD_SGOV),
  rwa("SLV", "Silver", ROBINHOOD_SLV),
  rwa("SNDK", "Sandisk", ROBINHOOD_SNDK),
  rwa("SPCX", "SPACs", ROBINHOOD_SPCX),
  rwa("SPY", "S&P 500", ROBINHOOD_SPY),
  rwa("TSLA", "Tesla", ROBINHOOD_TSLA),
  rwa("TSM", "TSMC", ROBINHOOD_TSM),
  rwa("USAR", "USA Rare Earth", ROBINHOOD_USAR),
  rwa("USO", "Oil", ROBINHOOD_USO),
];

