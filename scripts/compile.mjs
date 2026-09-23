import fs from 'node:fs/promises';
import path from 'node:path';
import solc from 'solc';

const root = process.cwd();
const sources = {};
async function collect(directory) {
  for (const file of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, file.name);
    if (file.isDirectory()) await collect(absolute);
    else if (file.name.endsWith('.sol')) {
      sources[path.relative(root, absolute).split(path.sep).join('/')] = {
        content: await fs.readFile(absolute, 'utf8'),
      };
    }
  }
}
await collect(path.join(root, 'contracts'));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
})));
for (const issue of output.errors ?? []) console.error(issue.formattedMessage);
if (output.errors?.some(issue => issue.severity === 'error')) process.exit(1);
await fs.mkdir('artifacts', { recursive: true });
for (const [sourceName, contracts] of Object.entries(output.contracts)) {
  for (const [contractName, result] of Object.entries(contracts)) {
    if (!result.evm.bytecode.object) continue;
    await fs.writeFile(`artifacts/${contractName}.json`, JSON.stringify({
      contractName, sourceName, compiler: solc.version(), evmVersion: 'cancun',
      abi: result.abi,
      bytecode: `0x${result.evm.bytecode.object}`,
      deployedBytecode: `0x${result.evm.deployedBytecode.object}`,
    }, null, 2) + '\n');
    console.log(`Compiled ${contractName} (${result.evm.deployedBytecode.object.length / 2} runtime bytes)`);
  }
}
console.log(`Compiler: ${solc.version()} | EVM: cancun`);
