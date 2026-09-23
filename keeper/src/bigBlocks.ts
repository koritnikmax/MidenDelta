/**
 * Enables HyperEVM "big blocks" (30M gas, ~1/min) for the deployer so large contracts can be deployed.
 * Signs the HyperCore L1 action {type:"evmUserModify", usingBigBlocks} and posts it to the testnet exchange.
 *   npm run big-blocks            -> enable
 *   npm run big-blocks -- off     -> back to small, fast blocks
 */
import { encode } from "@msgpack/msgpack";
import { keccak256, toBytes, concat, parseSignature, type Hex } from "viem";
import { account, HL_TESTNET_API } from "./config.js";

const enable = process.argv[2] !== "off";
const action = { type: "evmUserModify", usingBigBlocks: enable };
const nonce = Date.now();

// L1 action hash = keccak(msgpack(action) || nonce(u64 BE) || 0x00 (no vault))
const nonceBytes = new Uint8Array(8);
new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
const connectionId = keccak256(concat([encode(action), nonceBytes, new Uint8Array([0])]));

const signature = await account.signTypedData({
  domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
  types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
  primaryType: "Agent",
  message: { source: "b" /* testnet */, connectionId },
});
const { r, s, v } = parseSignature(signature as Hex);

const res = await fetch(`${HL_TESTNET_API}/exchange`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action, nonce, signature: { r, s, v: Number(v) } }),
});
console.log(`big blocks ${enable ? "ON" : "OFF"} for ${account.address}:`, res.status, await res.text());
void toBytes;
