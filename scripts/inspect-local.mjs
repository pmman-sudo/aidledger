import fs from 'node:fs/promises';
import { Contract, formatEther } from 'ethers';
import { localhost, artifact } from './runtime.mjs';

const env = await localhost();
try {
  let deployment;
  try { deployment = JSON.parse(await fs.readFile('deployments/localhost.json', 'utf8')); }
  catch { throw new Error('No local deployment found. Run npm run deploy:local first.'); }
  const data = await artifact();
  const code = await env.provider.getCode(deployment.contractAddress);
  if (code !== data.deployedBytecode) throw new Error('The local node was reset or this deployment is stale. Run npm run deploy:local on a fresh node.');
  const ledger = new Contract(deployment.contractAddress, data.abi, env.provider);
  const count = await ledger.campaignCount();
  console.log(`AidLedger: ${deployment.contractAddress}`);
  console.log(`Chain ID: ${(await env.provider.getNetwork()).chainId}`);
  console.log(`Campaigns: ${count}`);
  console.log(`Recorded escrow: ${formatEther(await ledger.totalEscrowed())} local ETH`);
  for (let campaignId = 0n; campaignId < count; campaignId++) {
    const campaign = await ledger.getCampaign(campaignId);
    console.log(`${campaignId}: ${campaign.title} | raised ${formatEther(campaign.raised)} | released ${formatEther(campaign.released)} | available ${formatEther(campaign.available)} local ETH`);
  }
} finally { await env.close(); }
