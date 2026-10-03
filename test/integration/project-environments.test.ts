import {strict as assert} from 'node:assert';
import {beforeEach, afterEach, describe, it} from 'mocha';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FileSystemAdapter} from '../support/obsidian-stub';
import {discoverPythonEnvironments, getProjectPythonEnvironment} from '../../src/utils/pythonEnvironmentDiscovery';
import {workspace, testPython, mkdir, join, rm} from '../support/environment';

describe('Project Python environment discovery', () => {
 let root: string, repo: string, vault: string, python: string, app: any;
 beforeEach(async () => {
  root = await workspace(); repo = join(root, 'repository'); vault = join(root, 'vault');
  await mkdir(repo); await mkdir(vault);
  await promisify(execFile)(testPython('kernel'), ['-m', 'venv', '--without-pip', join(repo, '.venv')]);
  python = join(repo, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  app = {vault: {adapter: new FileSystemAdapter(vault)}};
 });
 afterEach(async () => {if (root) await rm(root, {recursive: true, force: true});});
 it('offers an external repository interpreter first and deduplicates its local .venv', async () => {
  const environments = await discoverPythonEnvironments(app, {cwd: vault, projectRoot: repo, environment: {language: 'python', executable: python, label: 'My project'}});
  assert.equal(environments[0].path, python);
  assert.equal(environments[0].label, 'Project environment: My project');
  assert.equal(environments[0].source, 'project');
  assert.equal(environments[0].type, 'venv');
  assert.equal(environments.filter(item => item.path === python).length, 1);
 });
 it('includes root-local project virtual environments even without an explicit runtime', async () => {
  const environments = await discoverPythonEnvironments(app, {cwd: vault, projectRoot: repo});
  assert.equal(environments[0].path, python);
  assert.equal(environments[0].source, 'project');
 });
 it('retains a missing selected interpreter as unavailable and never substitutes a global interpreter', async () => {
  const missing = join(repo, 'missing-env', 'bin', 'python');
  const environment = await getProjectPythonEnvironment({cwd: vault, projectRoot: repo, environment: {language: 'python', executable: missing}});
  assert.equal(environment?.path, missing);
  assert.equal(environment?.unavailable, true);
  assert.equal(environment?.version, 'Unavailable');
 });
});
