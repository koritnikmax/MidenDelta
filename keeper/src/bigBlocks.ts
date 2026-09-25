/**
 * Toggle HyperEVM big blocks for the keeper/deployer wallet.
 *   npm run big-blocks            -> enable
 *   npm run big-blocks -- off     -> back to small, fast blocks
 */
import { account } from "./config.js";
import { setBigBlocks } from "./hyperliquid.js";

const enable = process.argv[2] !== "off";
console.log(`big blocks ${enable ? "ON" : "OFF"} for ${account.address}:`, await setBigBlocks(enable));
