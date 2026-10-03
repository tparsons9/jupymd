import {strict as assert} from 'node:assert';
import {beforeEach, afterEach, describe, it} from 'mocha';
import {mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {freshVault, openNote, seedPair, notebook, browser, $, obsidianPage} from '../support/obsidian';
import {testPython} from '../support/environment';

describe('Project environment kernel selection', () => {
 let repository: string;
 beforeEach(async () => {repository = await mkdtemp(join(tmpdir(), 'jupymd-project-')); await freshVault();});
 afterEach(async () => {
  await browser.executeObsidian(async ({plugins}) => {await plugins.jupymd?.executor.cleanup();});
  await rm(repository, {recursive: true, force: true});
 });
 async function startPicker(target: string, executable: string, explicit = false) {
  await browser.executeObsidian(({app, plugins}, target, repository, executable, explicit) => {
   const g = globalThis as any, api = plugins.jupymd.api;
   g.__projectContext = {cwd: (app.vault.adapter as any).getBasePath(), projectRoot: repository, environment: {language: 'python', executable, label: 'Repository Python'}};
   g.__pickerResult = undefined; g.__pickerError = undefined;
   if (!explicit) api.registerExecutionContextResolver('project-test', async () => g.__projectContext);
   void api.pickKernel(target, explicit ? {context: g.__projectContext} : undefined)
    .then((kernel: unknown) => {g.__pickerResult = kernel;}, (error: Error) => {g.__pickerError = error.message;});
  }, join(obsidianPage.getVaultPath(), target), repository, executable, explicit);
  await $('input[placeholder="Select a kernel source…"]').waitForDisplayed();
  await $('.suggestion-item*=Project environment: Repository Python').waitForDisplayed();
 }
 it('uses the shared picker for an uncreated note without changing the active notebook or tooling Python', async () => {
  await seedPair('active.md', ['print(1)']); await openNote('active.md');
  const before = await notebook('active.md');
  await startPicker('future.md', testPython('kernel'), true);
  assert.match(await $('.suggestion-item').getText(), /Project environment: Repository Python/);
  await $('.suggestion-item*=Project environment: Repository Python').click();
  await browser.waitUntil(() => browser.executeObsidian(() => (globalThis as any).__pickerResult !== undefined));
  const result = await browser.executeObsidian(({plugins}) => ({kernel: (globalThis as any).__pickerResult, tooling: plugins.jupymd.settings.toolingPython}));
  assert.equal(result.kernel.interpreterPath, testPython('kernel'));
  assert.equal(result.tooling, testPython('tooling'));
  assert.equal(existsSync(join(obsidianPage.getVaultPath(), 'future.md')), false);
  assert.equal(existsSync(join(obsidianPage.getVaultPath(), 'future.ipynb')), false);
  assert.deepEqual(await notebook('active.md'), before);
 });
 it('shows a project mismatch and preserves the existing notebook when selection is cancelled', async () => {
  await seedPair('existing.md', ['print(1)']); await openNote('existing.md');
  const before = await notebook('existing.md');
  await startPicker('existing.md', testPython('tooling'));
  await browser.waitUntil(async () => (await $('.suggestion-item*=Project environment').getText()).includes('Different from current kernel'));
  await browser.keys('Escape');
  await browser.waitUntil(() => browser.executeObsidian(() => (globalThis as any).__pickerResult === null));
  assert.deepEqual(await notebook('existing.md'), before);
 });
 it('recommends the supplied interpreter in the Python environment suggester', async () => {
  await startPicker('future.md', testPython('kernel'));
  await $('.suggestion-item*=Python environments').click();
  await $('input[placeholder="Select a Python environment or type a custom path…"]').waitForDisplayed();
  await $('.suggestion-item*=Project environment: Repository Python').waitForDisplayed();
  assert.match(await $('.suggestion-item').getText(), /Project environment: Repository Python/);
  await browser.keys('Escape');
  await $('input[placeholder="Select a kernel source…"]').waitForDisplayed();
  await browser.keys('Escape');
  await browser.waitUntil(() => browser.executeObsidian(() => (globalThis as any).__pickerResult === null));
 });
 it('keeps a missing project interpreter visible as unavailable', async () => {
  await startPicker('future.md', join(repository, '.venv', 'bin', 'missing-python'));
  assert.match(await $('.suggestion-item*=Project environment').getText(), /Unavailable/);
  await browser.keys('Escape');
  await browser.waitUntil(() => browser.executeObsidian(() => (globalThis as any).__pickerResult === null));
 });
 it('rejects selection when the registered project environment changes while the picker is open', async () => {
  await startPicker('future.md', testPython('kernel'));
  await browser.executeObsidian((_, executable) => {(globalThis as any).__projectContext.environment.executable = executable;}, testPython('tooling'));
  await $('.suggestion-item*=Project environment: Repository Python').click();
  await browser.waitUntil(() => browser.executeObsidian(() => !!(globalThis as any).__pickerError));
  assert.match(await browser.executeObsidian(() => (globalThis as any).__pickerError), /project or environment changed/);
  assert.equal(existsSync(join(obsidianPage.getVaultPath(), 'future.ipynb')), false);
 });
});
