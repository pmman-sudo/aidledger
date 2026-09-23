import fs from 'node:fs/promises';
import { BrowserProvider, ContractFactory, JsonRpcProvider, keccak256 } from 'ethers';

export const CHAIN_ID = 31337n;
export const LOCAL_RPC = 'http://127.0.0.1:8545';
export const Status = Object.freeze({ Planned: 0n, Pending: 1n, Approved: 2n, Rejected: 3n, Released: 4n });
export const statusNames = ['Planned', 'Pending', 'Approved', 'Rejected', 'Released'];
export const artifact = async (name = 'AidLedger') => JSON.parse(await fs.readFile(`artifacts/${name}.json`, 'utf8'));

export async function assertLocal(provider) {
  const chainId = BigInt(await provider.send('eth_chainId', []));
  if (chainId !== CHAIN_ID) throw new Error(`Expected local chain 31337; received ${chainId}.`);
}

export async function simulation() {
  const { network } = await import('hardhat');
  const connection = await network.create('aidledger');
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  await assertLocal(provider);
  return {
    provider,
    close: async () => { await provider.destroy(); await connection.close(); },
  };
}

export async function localhost() {
  const provider = new JsonRpcProvider(LOCAL_RPC, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  provider.pollingInterval = 50;
  try {
    await assertLocal(provider);
    const version = await provider.send('web3_clientVersion', []);
    if (!version.toLowerCase().includes('hardhat')) throw new Error('Start this package’s Hardhat node with npm run node.');
  } catch (error) {
    await provider.destroy();
    throw new Error(`Local Hardhat node unavailable. Run npm run node in another terminal. ${error.message}`);
  }
  return { provider, close: () => provider.destroy() };
}

export async function accounts(provider) {
  const [organizer, verifier, donor, recipient, stranger, donorTwo] = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(i => provider.getSigner(i)),
  );
  return { organizer, verifier, donor, recipient, stranger, donorTwo };
}

export async function deploy(provider, signer, name = 'AidLedger', args = []) {
  await assertLocal(provider);
  const data = await artifact(name);
  const contract = await new ContractFactory(data.abi, data.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

export async function hashFile(file) {
  const bytes = await fs.readFile(file);
  return keccak256(bytes);
}

export function decodeError(contract, error) {
  if (error?.revert?.name) return error.revert.name;
  const candidates = [error?.data, error?.data?.data, error?.info?.error?.data,
    error?.info?.error?.data?.data, error?.error?.data];
  for (const data of candidates) {
    if (typeof data !== 'string') continue;
    try { return contract.interface.parseError(data)?.name; } catch { /* try the next shape */ }
  }
  return undefined;
}

export async function settled(transaction) {
  const receipt = await (await transaction).wait();
  if (receipt.status !== 1) throw new Error('Transaction failed.');
  return receipt;
}

export const json = value => JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2) + '\n';
