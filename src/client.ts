import {
  type Account,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { SupportedChainId } from "./addresses.js";
import { chains } from "./addresses.js";

export function createProtocolPublicClient(opts?: {
  chainId?: SupportedChainId;
  rpcUrl?: string;
}): PublicClient {
  const chainId = opts?.chainId ?? 31337;
  const chain = chains[chainId] ?? foundry;
  const transport = http(opts?.rpcUrl ?? process.env.RPC_URL ?? "http://127.0.0.1:8545");
  return createPublicClient({ chain, transport });
}

export function createProtocolWalletClient(opts: {
  privateKey: Hex;
  chainId?: SupportedChainId;
  rpcUrl?: string;
}): WalletClient {
  const chainId = opts.chainId ?? 31337;
  const chain: Chain = chains[chainId] ?? foundry;
  const transport: Transport = http(opts.rpcUrl ?? process.env.RPC_URL ?? "http://127.0.0.1:8545");
  const account: Account = privateKeyToAccount(opts.privateKey);
  return createWalletClient({ account, chain, transport });
}
