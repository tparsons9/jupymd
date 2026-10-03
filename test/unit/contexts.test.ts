import {strict as assert} from 'node:assert';
import {describe, it} from 'mocha';
import {mkdtemp, mkdir, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionContexts, type NotebookExecutionContext} from '../../src/kernels/ExecutionContexts';
describe('Notebook execution context registration', () => {
 it('carries recommendation diagnostics to the picker without invalidating session directories', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jupy-context-')), root = await realpath(temp);
  try {
   const contexts = new ExecutionContexts(), note = join(root, 'note.md');
   contexts.register('recommendation', async () => ({cwd: root, projectRoot: root, environmentError: 'Multiple Python environments. Select a project environment.'}));
   contexts.sessions.set(note, {notePath: note, kernel: 'existing', cwd: root, status: 'idle'});
   assert.match((await contexts.resolve(note)).environmentError!, /Multiple Python environments/);
   assert.equal(await contexts.directory(note), root); assert.equal((await contexts.list())[0].status, 'idle');
   await assert.rejects(contexts.validate({cwd: join(root, 'missing'), environmentError: 'Recommendation unavailable'}));
  } finally { await rm(temp, {recursive: true}); }
 });
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
 it('keeps the project environment independent of the notebook startup directory and selected session', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jupy-context-')), root = await realpath(temp);
  try {
   const repo = join(root, 'repo'), notes = join(root, 'notes');
   await mkdir(repo); await mkdir(notes);
   const contexts = new ExecutionContexts(), note = join(notes, 'note.md');
   const context: NotebookExecutionContext = {cwd: notes, projectRoot: repo, environment: {language: 'python', executable: join(repo, '.venv', 'bin', 'python'), label: 'Repository'}};
   contexts.register('copilotcodeblocks', async () => context);
   assert.deepEqual(await contexts.resolve(note), context);
   contexts.sessions.set(note, {notePath: note, kernel: 'explicit-kernel', cwd: notes, status: 'idle'});
   context.environment!.executable = join(repo, 'other-env', 'bin', 'python');
   assert.equal((await contexts.list())[0].kernel, 'explicit-kernel');
   assert.equal((await contexts.list())[0].status, 'idle');
   assert.equal(await contexts.directory(note), notes);
  } finally { await rm(temp, {recursive: true}); }
 });
 it('rejects conflicting environments and ambiguous executable paths', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jupy-context-')), root = await realpath(temp);
  try {
   const contexts = new ExecutionContexts();
   contexts.register('first', async () => ({cwd: root, environment: {language: 'python', executable: join(root, 'python')}}));
   const remove = contexts.register('second', async () => ({cwd: root, environment: {language: 'python', executable: join(root, 'other-python')}}));
   await assert.rejects(contexts.resolve(join(root, 'note.md')), /Conflicting notebook environments/);
   remove();
   contexts.register('relative', async () => ({cwd: root, environment: {language: 'python', executable: 'python3'}}));
   await assert.rejects(contexts.resolve(join(root, 'note.md')), /Conflicting notebook environments/);
   await assert.rejects(contexts.validate({cwd: root, environment: {language: 'python', executable: 'python3'}}), /absolute executable path/);
  } finally { await rm(temp, {recursive: true}); }
 });
});
