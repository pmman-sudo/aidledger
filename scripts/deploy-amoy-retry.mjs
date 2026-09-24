import fs from 'node:fs/promises';
import {
  ContractFactory, JsonRpcProvider, Wallet,
  formatEther, parseEther, keccak256, getCreateAddress
} from 'ethers';

const provider = new JsonRpcProvider(
  process.env.AMOY_RPC_URL, 80002, { batchMaxCount: 1 }
);

try {
  if (!process.env.AMOY_RPC_URL || !process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('SETUP: RPC URL and deployer key are required.');
  }

  for (const file of ['deployments/amoy.json', 'deployments/amoy-retry.json']) {
    try {
      await fs.access(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`SETUP: ${file} already exists. Check it before deploying again.`);
  }

  const chainId = BigInt(await provider.send('eth_chainId', []));
  if (chainId !== 80002n) {
    throw new Error('SETUP: RPC is not Polygon Amoy.');
  }

  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY.trim(), provider);
  delete process.env.DEPLOYER_PRIVATE_KEY;

  if (wallet.address.toLowerCase() !== '0x75991e9a42d1966b4ba13fcc0e85bf4e03cc23a7') {
    throw new Error('SETUP: This key does not match your funded wallet ending C23A7.');
  }

  const original = JSON.parse(
    await fs.readFile('deployments/amoy-pending.json', 'utf8')
  );
  const expectedAddress = getCreateAddress({ from: wallet.address, nonce: 0 });

  if (
    original.chainId !== 80002 ||
    original.deployer.toLowerCase() !== wallet.address.toLowerCase() ||
    original.contractAddress.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new Error('SETUP: Original deployment does not match transaction number 0.');
  }

  const confirmedCount = await provider.getTransactionCount(wallet.address, 'latest');
  const pendingCount = await provider.getTransactionCount(wallet.address, 'pending');

  if (confirmedCount !== 0 || pendingCount !== 0) {
    throw new Error('SETUP: Wallet transaction count changed. Check the original transaction.');
  }
  if (await provider.getCode(expectedAddress) !== '0x') {
    throw new Error('SETUP: Contract already exists. Recover the deployment instead.');
  }

  const artifact = JSON.parse(
    await fs.readFile('artifacts/AidLedgerCloud.json', 'utf8')
  );
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const request = await factory.getDeployTransaction();
  const gas = await wallet.estimateGas(request);
  const gasLimit = (gas * 120n + 99n) / 100n;
  const fees = await provider.getFeeData();

  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) {
    throw new Error('SETUP: RPC did not supply fee estimates.');
  }

  const maximumCost = gasLimit * fees.maxFeePerGas;
  const balance = await provider.getBalance(wallet.address);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${formatEther(balance)} test POL`);
  console.log(`Maximum transaction fee: ${formatEther(maximumCost)} test POL`);

  if (maximumCost > parseEther('0.5')) {
    throw new Error('SETUP: Fee exceeds the 0.5 test POL limit.');
  }
  if (balance < maximumCost) {
    throw new Error('SETUP: Insufficient test POL.');
  }

  const populated = await wallet.populateTransaction({
    ...request,
    nonce: 0,
    chainId: 80002,
    type: 2,
    gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas
  });

  const signed = await wallet.signTransaction(populated);
  const transactionHash = keccak256(signed);
  const record = {
    network: 'polygon-amoy',
    chainId: 80002,
    contractAddress: getCreateAddress({
      from: wallet.address,
      nonce: populated.nonce
    }),
    transactionHash,
    deployer: wallet.address
  };

  await fs.mkdir('deployments', { recursive: true });
  await fs.writeFile(
    'deployments/amoy-retry.json',
    JSON.stringify(record, null, 2) + '\n',
    { flag: 'wx' }
  );

  console.log(`Transaction hash saved before broadcast: ${transactionHash}`);
  await provider.broadcastTransaction(signed);
  console.log('Broadcast complete. Waiting for confirmation...');

  const receipt = await provider.waitForTransaction(transactionHash, 1, 180000);
  if (!receipt || receipt.status !== 1) {
    throw new Error('SETUP: Deployment not confirmed successful.');
  }
  if (receipt.contractAddress?.toLowerCase() !== record.contractAddress.toLowerCase()) {
    throw new Error('SETUP: Unexpected deployed address.');
  }
  if (await provider.getCode(record.contractAddress) === '0x') {
    throw new Error('SETUP: No contract code found.');
  }

  record.deploymentBlock = receipt.blockNumber;
  await fs.writeFile(
    'deployments/amoy.json',
    JSON.stringify(record, null, 2) + '\n',
    { flag: 'wx' }
  );

  console.log(`SUCCESS: AidLedgerCloud deployed at ${record.contractAddress}`);
  console.log(`Deployment block: ${record.deploymentBlock}`);
  console.log('Saved deployments/amoy.json.');
} catch (error) {
  console.error(
    error.message?.startsWith('SETUP:')
      ? error.message
      : `Deployment stopped: ${error.code || 'UNKNOWN_ERROR'}`
  );
  console.error('Keep any deployment records. Share this output before retrying.');
  process.exitCode = 1;
} finally {
  delete process.env.DEPLOYER_PRIVATE_KEY;
  provider.destroy();
}