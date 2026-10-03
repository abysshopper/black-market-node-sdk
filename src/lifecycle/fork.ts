import { LifecyclePlanningError, type ControlledLifecycleFork, type LifecycleRpcClient } from "./types.js";
import { rpcObject } from "./rpc.js";

/**
 * Connects an explicitly disposable loopback fork. Only the fork receives resets/transactions;
 * sourceRpcUrl is used by the fork node for read-only canonical state synchronization.
 */
export function createControlledLifecycleFork(options: {
  sourceRpcUrl: string; forkRpcUrl: string; allowTransactions: true;
  fetch?: typeof globalThis.fetch; impersonation?: "anvil" | "hardhat" | "none";
  resetMethod?: "anvil_reset" | "hardhat_reset"; receiptTimeoutMs?: number;
}): ControlledLifecycleFork {
  const source = new URL(options.sourceRpcUrl);
  const fork = new URL(options.forkRpcUrl);
  if (!["http:", "https:"].includes(source.protocol) || !["http:", "https:"].includes(fork.protocol)) throw new LifecyclePlanningError("UNSAFE_FORK", "Controlled fork RPCs must use HTTP(S)");
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"];
  const sourcePort = source.port || (source.protocol === "https:" ? "443" : "80");
  const forkPort = fork.port || (fork.protocol === "https:" ? "443" : "80");
  if (!loopback.includes(fork.hostname) || (loopback.includes(source.hostname) && sourcePort === forkPort) || source.href === fork.href || options.allowTransactions !== true) throw new LifecyclePlanningError("UNSAFE_FORK", "Controlled fork must be an explicit, distinct disposable loopback RPC, not a localhost/IP alias of the source");
  const fetch = options.fetch ?? globalThis.fetch;
  let id = 0;
  const client: LifecycleRpcClient = {
    async request({ method, params }: { method: string; params?: readonly unknown[] }) {
      const response = await fetch(fork.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
      if (!response.ok) throw new LifecyclePlanningError("FORK_RPC_ERROR", `Disposable fork RPC returned HTTP ${response.status}`);
      const result = rpcObject(await response.json(), "fork JSON-RPC envelope");
      if (result.error !== undefined) {
        const error = rpcObject(result.error, "fork JSON-RPC error");
        throw new LifecyclePlanningError("FORK_RPC_ERROR", typeof error.message === "string" ? error.message : "Disposable fork RPC returned an error");
      }
      if (!("result" in result)) throw new LifecyclePlanningError("INVALID_RPC_RESPONSE", "Disposable fork RPC omitted its result");
      return result.result;
    },
  };
  return { client, isolation: "disposable", allowTransactions: true, sourceRpcUrl: source.href, forkRpcUrl: fork.href, resetMethod: options.resetMethod ?? "anvil_reset", impersonation: options.impersonation ?? "anvil", receiptTimeoutMs: options.receiptTimeoutMs };
}
