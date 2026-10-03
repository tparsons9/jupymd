import {strict as assert} from 'node:assert';
import {describe, it} from 'mocha';
import {join, resolve} from 'node:path';
import {FileSystemAdapter} from '../support/obsidian-stub';
import {NotebookApi} from '../../src/api/NotebookApi';

describe('Notebook kernel picker API', () => {
 it('targets an uncreated vault note and returns cancellation without pairing or selecting a kernel', async () => {
  const vault = resolve('test/fixtures/vault'), target = join(vault, 'new-note.md');
  const options = {context: {cwd: vault, projectRoot: resolve('../copilotcodeblocks'), environment: {language: 'python', executable: join(vault, '.venv/bin/python')}}};
  let picked = false;
  const api = new NotebookApi({
   app: {vault: {adapter: new FileSystemAdapter(vault)}},
   pickKernelForNote: async (note: string, supplied: unknown) => {assert.equal(note, target); assert.equal(supplied, options); picked = true; return null;},
  } as any);
  assert.equal(api.capabilities.kernelPicker, true);
  assert.equal(api.capabilities.projectEnvironments, true);
  assert.equal(await api.pickKernel(target, options), null);
  assert.equal(picked, true);
 });
 it('rejects paths outside the vault and non-Markdown paths before opening the picker', async () => {
  const vault = resolve('test/fixtures/vault');
  const api = new NotebookApi({app: {vault: {adapter: new FileSystemAdapter(vault)}}} as any);
  await assert.rejects(api.pickKernel(join(vault, '..', 'outside.md')), /inside the vault/);
  await assert.rejects(api.pickKernel('relative.md'), /absolute Markdown path/);
  await assert.rejects(api.pickKernel(join(vault, 'notebook.ipynb')), /absolute Markdown path/);
 });
});
