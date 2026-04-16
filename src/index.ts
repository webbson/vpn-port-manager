import { loadConfig } from "./config.js";

const config = loadConfig();
console.log(`VPN Port Manager starting with provider: ${config.vpnProvider}`);
