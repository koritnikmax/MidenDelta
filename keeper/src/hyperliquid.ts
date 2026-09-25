/** HyperCore helpers for the keeper wallet: big-block toggle (signed L1 action) and account lookup. */
import { encode } from "@msgpack/msgpack";
import { keccak256, concat, parseSignature, type Hex } from "viem";
import { account, HL_TESTNET_API } from "./config.js";

/** HyperEVM "big blocks" (30M gas, ~1 per minute) are needed to deploy contracts larger than the 2M small-block limit. */
export async function setBigBlocks(enable: boolean): Promise<string> {
  const action = { type: "evmUserModify", usingBigBlocks: enable };
  const nonce = Date.now();
  // L1 action hash = keccak(msgpack(action) || nonce (u64 BE) || 0x00 (no vault))
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
  const body = await res.text();
  if (!res.ok || body.includes('"err"')) throw new Error(`big blocks ${enable ? "on" : "off"} failed: ${body}`);
  return body;
}

/** "missing" until the address has received funds on HyperCore; big blocks need an existing account. */
export async function coreRole(user: Hex): Promise<string> {
  const res = await fetch(`${HL_TESTNET_API}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "userRole", user }),
  });
  return ((await res.json()) as { role: string }).role;
}
