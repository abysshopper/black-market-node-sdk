// Reviewed launch planning only: no signatures, source-chain writes, uploads or publication.
import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import {
  buildNextTransaction, createControlledLifecycleFork, parseLaunchPlan, planLaunch,
  prepareAndPlanLifecycleLaunch, readLaunchProgress, readLifecycleProfiles, serializeLaunchPlan,
} from "@black-market/sdk";
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const planFile = option("--plan"), rpcUrl = option("--rpc"), mode = option("--mode");
if (!planFile || !rpcUrl || !["atomic", "staged"].includes(mode)) {
  throw new Error("Usage: node examples/launch.mjs --plan plan.json --rpc RPC_URL --mode atomic|staged [--limits current-limits.json] [--receipts receipts.json] [--confirmations N] [--fork-rpc LOOPBACK_RPC_URL] [--mine]");
}
const client = createPublicClient({ transport: http(rpcUrl) });
const plan = parseLaunchPlan(await readFile(planFile, "utf8"));
if (BigInt(await client.getChainId()) !== plan.chainId) throw new Error("RPC chain ID differs from the saved plan");
const profiles = await readLifecycleProfiles({ client, orchestrator: plan.orchestrator, profileIds: [...new Set(plan.markets.map((market) => market.profileId))] });
for (const profile of profiles) console.log(profile.id, profile.venueKind, profile.topology, profile.admitted ? "admitted" : profile.reason);
const limitsFile = option("--limits");
const limits = limitsFile ? JSON.parse(await readFile(limitsFile, "utf8")) : undefined;
if (limits) for (const key of ["chainId", "observedBlockNumber", "chainGasLimit", "rpcGasLimit", "accountGasLimit", "maxSimulationGas"]) {
  if (limits[key] !== undefined) limits[key] = BigInt(limits[key]);
}
const receiptsFile = option("--receipts");
const receipts = receiptsFile ? JSON.parse(await readFile(receiptsFile, "utf8"), (key, value) => key === "observedBlockNumber" ? BigInt(value) : value) : [];
const confirmations = Number(option("--confirmations") ?? "1");
const forkRpcUrl = option("--fork-rpc");
const fork = forkRpcUrl ? createControlledLifecycleFork({ sourceRpcUrl: rpcUrl, forkRpcUrl, allowTransactions: true, impersonation: "anvil" }) : undefined;
const options = { client, account: plan.creator, plan, mode, limits, fork, receipts, confirmations };
const planned = args.includes("--mine")
  ? await prepareAndPlanLifecycleLaunch({ ...options, onProgress: ({ marketIndex, attempts }) => console.error("salt mining", marketIndex, attempts.toString()) })
  : await planLaunch(options);
const progress = await readLaunchProgress({ client, planned, receipts, confirmations });
const next = planned.simulation.admitted ? await buildNextTransaction({ client, planned, limits, fork, receipts, confirmations }) : undefined;
console.log(JSON.stringify({ plan: JSON.parse(serializeLaunchPlan(planned.plan)), mode,
  simulation: planned.simulation, progress, next },
  (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
// Persist the returned plan/mode/confirmation policy and receipt references. An application
// must separately review, authenticate its wallet chain and sign exactly `next` if admitted.
