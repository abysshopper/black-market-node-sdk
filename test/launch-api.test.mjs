import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import { canonicalLaunchMetadataHash, sha256Hex } from "../dist/index.js";

test("metadata hashing matches API text, URL, null, and field-order normalization", () => {
  const metadata = {
    name: " Cafe\u0301 ", symbol: " CF ", description: " description ",
    websiteUrl: " https://example.org ", twitterUrl: "https://example.org/space%20here",
  };
  const canonical = '{"name":"Caf\u00e9","symbol":"CF","description":"description","websiteUrl":"https://example.org/","twitterUrl":"https://example.org/space%20here","telegramUrl":null,"discordUrl":null,"imageKey":null}';
  assert.equal(canonicalLaunchMetadataHash(metadata), keccak256(stringToHex(canonical)));
  assert.equal(canonicalLaunchMetadataHash(metadata), canonicalLaunchMetadataHash({
    name: "Caf\u00e9", symbol: "CF", description: "description", websiteUrl: "https://example.org/", twitterUrl: metadata.twitterUrl,
  }));
  assert.notEqual(canonicalLaunchMetadataHash({ ...metadata, description: "changed" }), canonicalLaunchMetadataHash(metadata));
});

test("image sha256 bytes match the public API descriptor encoding", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc").buffer), "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
