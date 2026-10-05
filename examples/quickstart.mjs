// Read-only deployed graph discovery. No signatures, transactions, uploads, or publication.
import { zeroAddress } from "viem";
import {
  createProtocolPublicClient, getAddresses, isSupportedChainId,
  launchLifecycleAbi, readLifecycleProfiles,
} from "../dist/index.js";

const chainId = Number(process.env.CHAIN_ID ?? "4663");
if (!isSupportedChainId(chainId)) throw new Error("CHAIN_ID must be 4663, 46631, or 31337");
const infrastructure = getAddresses(chainId);
if (infrastructure.launchOrchestrator === zeroAddress) {
  throw new Error("Set LAUNCH_ORCHESTRATOR and the matching deployment addresses for this local chain; no mainnet launch address is assumed locally.");
}
const client = createProtocolPublicClient({ chainId });
if (await client.getChainId() !== chainId) throw new Error("RPC chain ID differs from CHAIN_ID");
const registry = await client.readContract({
  address: infrastructure.launchOrchestrator,
  abi: launchLifecycleAbi,
  functionName: "registry",
});
if (registry.toLowerCase() !== infrastructure.launchImplementationRegistry.toLowerCase()) {
  throw new Error("The selected orchestrator and LAUNCH_IMPLEMENTATION_REGISTRY are not the same deployment graph");
}
const profiles = await readLifecycleProfiles({ client, orchestrator: infrastructure.launchOrchestrator });
console.log("chain:", chainId);
console.log("orchestrator:", infrastructure.launchOrchestrator);
console.log("registry:", registry);
console.table(profiles.map((profile) => ({
  profile: profile.id,
  venue: profile.venueKind,
  configVersion: profile.topology.configVersion,
  admitted: profile.admitted,
  reason: profile.reason ?? "",
})));
console.log("Abyss router:", infrastructure.abyssRouter);
console.log("lending pool:", infrastructure.lendingPool);
if (!profiles.some((profile) => profile.admitted)) throw new Error("No current profile was admitted by the selected deployment");
