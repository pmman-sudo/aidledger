import fs from 'node:fs/promises';
import { formatEther } from 'ethers';
import { localhost, accounts, deploy, artifact, json, LOCAL_RPC } from './runtime.mjs';

const env = await localhost();
try {
  const data = await artifact();
  let previous;
  try { previous = JSON.parse(await fs.readFile('deployments/localhost.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    const existing = await env.provider.getCode(previous.contractAddress);
    if (existing !== '0x') {
      if (existing !== data.deployedBytecode) {
        throw new Error('The stored deployment points to different bytecode. Use a fresh local node and redeploy.');
      }
      console.log(`Reusing AidLedger at ${previous.contractAddress}`);
      console.log('No additional contract was created. Run npm run inspect:local.');
      process.exitCode = 0;
    } else previous = undefined;
  }
  if (!previous) {
    const people = await accounts(env.provider);
    const ledger = await deploy(env.provider, people.organizer);
    const receipt = await ledger.deploymentTransaction().wait();
    await fs.mkdir('deployments', { recursive: true });
    await fs.writeFile('deployments/localhost.json', json({
      network: 'localhost', chainId: 31337, rpcUrl: LOCAL_RPC,
      contractAddress: ledger.target, transactionHash: receipt.hash,
      deploymentBlock: receipt.blockNumber,
      accounts: Object.fromEntries(Object.entries(people).map(([role, signer]) => [role, signer.address])),
      currency: 'valueless local ETH', abi: data.abi,
    }));
    console.log(`Deployed AidLedger at ${ledger.target}`);
    console.log('Saved deployments/localhost.json with address, ABI, and local account addresses.');
    console.log(`Organizer local test balance: ${formatEther(await env.provider.getBalance(people.organizer.address))} local ETH`);
    console.log('No campaigns have been seeded. The demo command uses its own separate temporary chain.');
  }
} finally { await env.close(); }
