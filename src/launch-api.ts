import { setTimeout as delay } from "node:timers/promises";
import { keccak256, stringToHex, type Address, type Hash, type Hex } from "viem";

export const DEFAULT_LAUNCH_API_URL = "https://api.abyss.trading";
export const LAUNCH_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LaunchImageContentType = (typeof LAUNCH_IMAGE_CONTENT_TYPES)[number];
export const MAX_LAUNCH_IMAGE_BYTES = 5 * 1024 * 1024;
export type LaunchSessionMetadata = { name: string; symbol: string; description?: string; websiteUrl?: string; twitterUrl?: string; telegramUrl?: string; discordUrl?: string; imageKey?: string };
/** Metadata accepted by a new upload session. imageKey is assigned by the API, never supplied here. */
export type LaunchSessionCreateMetadata = {
  name: string; symbol: string; description: string; websiteUrl?: string; twitterUrl?: string; telegramUrl?: string; discordUrl?: string;
};
export type LaunchSessionImageDescriptor = { sha256: Hex; contentType: LaunchImageContentType; contentLength: number };
export type LaunchAttributionAuthorization = { nonce: Hex; deadline: string; signature: Hex };
export type LaunchSessionCreateRequest = { chainId: number; wallet: Address; metadata: LaunchSessionCreateMetadata; image?: LaunchSessionImageDescriptor; authorization: LaunchAttributionAuthorization };
export type LaunchSessionPublishRequest = { chainId: number; transactionHash: Hash };
export type LaunchSessionStatus = "awaiting_upload" | "verifying_image" | "ready_to_launch" | "transaction_submitted" | "awaiting_indexer" | "optimistic" | "final" | "reorged" | "expired" | "rejected";
export type LaunchSessionDirectUpload = { url: string; headers: Record<string, string>; expiresAt: string };
export type LaunchSessionResponse = { sessionId: string; chainId: number; wallet: Address; status: LaunchSessionStatus; metadata: { name: string; symbol: string; description: string | null; websiteUrl: string | null; twitterUrl: string | null; telegramUrl: string | null; discordUrl: string | null }; image: { sha256: Hex; contentType: LaunchImageContentType; contentLength: number; width: number | null; height: number | null } | null; transactionHash?: Hash | null; token?: Address | null; canonicalStatus: "pending" | "optimistic" | "final" | "reorged"; metadataStatus: "queued" | "ready" | "needs_owner_action" | "none"; imageStatus: "none" | "upload_pending" | "verifying" | "ready" | "rejected"; retryable: boolean; createdAt: string; updatedAt: string; sessionExpiresAt: string; publishedAt?: string; upload?: LaunchSessionDirectUpload; capability?: string; imageUrl?: string };
export type LaunchApiErrorCode = "INVALID_REQUEST" | "INVALID_ADDRESS" | "INVALID_IDEMPOTENCY_KEY" | "INVALID_CAPABILITY" | "UNSUPPORTED_CHAIN" | "NOT_FOUND" | "IMAGE_INVALID" | "SESSION_STATE_CONFLICT" | "SESSION_EXPIRED" | "IDEMPOTENCY_CONFLICT" | "UPLOAD_CONFLICT" | "RATE_LIMITED" | "OVERLOADED" | "RPC_UNAVAILABLE" | "RPC_TIMEOUT" | "INDEXER_UNAVAILABLE" | "APP_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "TX_REVERTED" | "TX_PROVENANCE_MISMATCH" | "TX_METADATA_MISMATCH" | (string & {});

export class LaunchApiError extends Error {
  readonly status: number;
  readonly code: LaunchApiErrorCode;
  readonly retryAfterMs?: number;
  constructor(status: number, code: LaunchApiErrorCode, message: string, retryAfterMs?: number) {
    super(message); this.name = "LaunchApiError"; this.status = status; this.code = code; this.retryAfterMs = retryAfterMs;
  }
}
export class LaunchPublishPending extends Error {
  readonly session: LaunchSessionResponse;
  readonly retryAfterMs: number;
  constructor(session: LaunchSessionResponse, retryAfterMs: number) {
    super("Launch transaction is confirmed but indexing is still pending."); this.name = "LaunchPublishPending"; this.session = session; this.retryAfterMs = retryAfterMs;
  }
}
export type LaunchApiClientOptions = { baseUrl?: string; fetch?: typeof globalThis.fetch; retries?: number };

/** Optional client for the web app's signed metadata/upload/publication lifecycle. */
export class LaunchApiClient {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly retries: number;
  constructor(options: LaunchApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_LAUNCH_API_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    if (this.fetch === undefined) throw new Error("A fetch implementation is required for LaunchApiClient");
    this.retries = options.retries ?? 3;
  }
  async createUploadSession(body: LaunchSessionCreateRequest, idempotencyKey: string): Promise<LaunchSessionResponse> {
    return this.request("POST", "/api/v1/launch-upload-sessions", body.chainId, { body, idempotencyKey });
  }
  async getUploadSession(chainId: number, sessionId: string, capability: string): Promise<LaunchSessionResponse> {
    return this.request("GET", `/api/v1/launch-upload-sessions/${encodeURIComponent(sessionId)}`, chainId, { capability });
  }
  async renewUploadUrl(chainId: number, sessionId: string, capability: string): Promise<LaunchSessionResponse> {
    return this.request("POST", `/api/v1/launch-upload-sessions/${encodeURIComponent(sessionId)}/upload-url`, chainId, { body: {}, capability });
  }
  async completeUpload(chainId: number, sessionId: string, capability: string): Promise<LaunchSessionResponse> {
    return this.request("POST", `/api/v1/launch-upload-sessions/${encodeURIComponent(sessionId)}/upload/complete`, chainId, { body: {}, capability });
  }
  async publishUploadSession(chainId: number, sessionId: string, capability: string, body: LaunchSessionPublishRequest): Promise<LaunchSessionResponse> {
    return this.request("POST", `/api/v1/launch-upload-sessions/${encodeURIComponent(sessionId)}/publish`, chainId, { body, capability, pendingOnAccepted: true });
  }
  async putImage(upload: LaunchSessionDirectUpload, body: Blob): Promise<void> {
    const response = await this.fetch(upload.url, { method: "PUT", headers: upload.headers, body });
    if (!response.ok) throw new LaunchApiError(response.status, "UPLOAD_CONFLICT", `Launch image upload failed with status ${response.status}.`);
  }
  private async request<T>(method: "GET" | "POST" | "PUT", path: string, chainId: number, options: { body?: unknown; capability?: string; idempotencyKey?: string; pendingOnAccepted?: boolean }): Promise<T> {
    const url = new URL(path, `${this.baseUrl}/`); url.searchParams.set("chainId", String(chainId));
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.capability !== undefined) headers.Authorization = `Launch-Upload-Capability ${options.capability}`;
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        const response = await this.fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
        const retryAfterMs = Math.max(250, Number(response.headers.get("Retry-After")) * 1000 || 0) || undefined;
        if (response.ok) {
          const value = await response.json() as T;
          if (response.status === 202 && options.pendingOnAccepted) throw new LaunchPublishPending(value as LaunchSessionResponse, retryAfterMs ?? 5_000);
          return value;
        }
        let code: LaunchApiErrorCode = "INVALID_REQUEST";
        let message = `Launch API request failed with status ${response.status}.`;
        try { const value = await response.json() as { code?: unknown; error?: unknown }; if (typeof value.code === "string") code = value.code; if (typeof value.error === "string") message = value.error; } catch { /* response body is optional */ }
        const error = new LaunchApiError(response.status, code, message, retryAfterMs);
        if (![429, 502, 503, 504].includes(response.status) || attempt + 1 === this.retries) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof LaunchPublishPending || error instanceof LaunchApiError && ![429, 502, 503, 504].includes(error.status)) throw error;
        lastError = error;
      }
      await delay(750 * 2 ** attempt);
    }
    throw lastError instanceof LaunchApiError ? lastError : new LaunchApiError(0, "RPC_UNAVAILABLE", lastError instanceof Error ? lastError.message : "The launch API is unreachable.");
  }
}
export const launchAttributionTypes = { LaunchAttribution: [
  { name: "chainId", type: "uint256" }, { name: "wallet", type: "address" }, { name: "metadataHash", type: "bytes32" },
  { name: "imageSha256", type: "bytes32" }, { name: "imageContentType", type: "string" }, { name: "imageContentLength", type: "uint256" },
  { name: "idempotencyKey", type: "string" }, { name: "nonce", type: "bytes32" }, { name: "deadline", type: "uint256" },
] } as const;
export function canonicalLaunchMetadataHash(metadata: LaunchSessionMetadata): Hex {
  return keccak256(stringToHex(JSON.stringify({ name: metadata.name.normalize("NFC").trim(), symbol: metadata.symbol.normalize("NFC").trim(), description: (metadata.description ?? "").normalize("NFC").trim(), websiteUrl: metadata.websiteUrl ?? null, twitterUrl: metadata.twitterUrl ?? null, telegramUrl: metadata.telegramUrl ?? null, discordUrl: metadata.discordUrl ?? null, imageKey: metadata.imageKey ?? null })));
}
export async function sha256Hex(bytes: ArrayBuffer): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}
