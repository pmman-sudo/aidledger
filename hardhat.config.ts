import { defineConfig } from "hardhat/config";

// Hardhat provides only the local EVM here. `npm run compile` uses the pinned
// solc npm package, avoiding a second compiler download at build time.
export default defineConfig({
  networks: {
    aidledger: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      hardfork: "cancun",
    },
  },
});
