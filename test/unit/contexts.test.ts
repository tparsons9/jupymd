import {strict as assert} from 'node:assert';
import {describe, it} from 'mocha';
import {mkdtemp, mkdir, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionContexts} from '../../src/kernels/ExecutionContexts';
describe('Notebook execution context registration', () => {
 it('uses a repository provider, detects stale sessions, and unregisters cleanly', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jupy-context-')), root = await realpath(temp);
  try {
   await mkdir(join(root, 'repo')); const contexts = new ExecutionContexts();
   assert.equal(await contexts.directory(join(root, 'note.md')), root);
   const remove = contexts.register('test', async () => ({cwd: join(root, 'repo')}));
   assert.equal(await contexts.directory(join(root, 'note.md')), join(root, 'repo'));
   contexts.sessions.set(join(root, 'note.md'), {notePath: join(root, 'note.md'), kernel: 'python', cwd: root, status: 'idle'});
   assert.equal((await contexts.list())[0].status, 'restart-required'); remove();
   assert.equal((await contexts.list())[0].status, 'idle'); contexts.dispose();
  } finally { await rm(temp, {recursive: true}); }
 });
});
