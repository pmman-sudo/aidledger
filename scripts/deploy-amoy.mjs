import fs from 'node:fs/promises';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';

const rpcUrl = process.env.AMOY_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !privateKey) throw new Error('Set AMOY_RPC_URL and DEPLOYER_PRIVATE_KEY for this one deployment command. Never put DEPLOYER_PRIVATE_KEY in the frontend or Northflank.');
const provider = new JsonRpcProvider(rpcUrl, 80002, { staticNetwork: true, batchMaxCount: 1 });
try {
  const network = await provider.getNetwork();
  if (network.chainId !== 80002n) throw new Error(`Expected Polygon Amoy chain 80002; RPC returned ${network.chainId}.`);
  const artifact = JSON.parse(await fs.readFile('artifacts/AidLedgerCloud.json', 'utf8'));
  const wallet = new Wallet(privateKey, provider);
  console.log(`Deploying from ${wallet.address} with ${formatEther(await provider.getBalance(wallet.address))} test POL`);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, wallet).deploy();
  const receipt = await contract.deploymentTransaction().wait();
  const deployment = { network: 'polygon-amoy', chainId: 80002, contractAddress: contract.target,
    transactionHash: receipt.hash, deploymentBlock: receipt.blockNumber, deployer: wallet.address };
  await fs.mkdir('deployments', { recursive: true });
  await fs.writeFile('deployments/amoy.json', JSON.stringify(deployment, null, 2) + '\n');
  console.log(`Deployed AidLedgerCloud at ${contract.target}`);
  console.log(`Deployment block: ${receipt.blockNumber}`);
  console.log('Saved deployments/amoy.json. Remove DEPLOYER_PRIVATE_KEY from your terminal after deployment.');
} finally { provider.destroy(); }
