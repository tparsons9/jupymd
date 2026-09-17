import {FileSystemAdapter, TFile} from 'obsidian';
import * as path from 'path';
import * as fs from 'fs/promises';
import type JupyMDPlugin from '../main';
import type {KernelConnection} from '../kernels/types';
import type {ExecutionContextResolver} from '../kernels/ExecutionContexts';
import {getExecutableCellIndex, getExecutableCellIndices, parseMarkdownCodeFences} from '../notebook/NotebookCellIndex';
import {isCodeCell, OUTPUTS_UPDATED_EVENT, parseNotebook} from '../components/types';
import {runJupytext} from '../utils/helpers';
export type NotebookAction = 'run' | 'all' | 'above' | 'below' | 'interrupt' | 'restart' | 'shutdown' | 'clear';
/** Versioned, explicitly targeted API. No operation depends on the active leaf. */
export class NotebookApi {
 readonly apiVersion = 1;
 constructor(private plugin: JupyMDPlugin) {}
 registerExecutionContextResolver(owner: string, resolver: ExecutionContextResolver) { return this.plugin.kernelService.contexts.register(owner, resolver); }
 subscribe(listener: () => void) { return this.plugin.kernelService.contexts.subscribe(listener); }
 getSessions() { return this.plugin.kernelService.contexts.list(); }
 listKernels() { return this.plugin.kernelService.listKernels(); }
 private file(notePath: string): TFile {
  const adapter = this.plugin.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) throw new Error('A local vault is required.');
  const relative = path.relative(adapter.getBasePath(), notePath);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Notebook must be inside the vault.');
  const file = this.plugin.app.vault.getAbstractFileByPath(relative.split(path.sep).join('/'));
  if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Notebook note is unavailable.');
  return file;
 }
 async pair(notePath: string, kernel: KernelConnection): Promise<void> {
  const file = this.file(notePath);
  try { await fs.access(notePath.replace(/\.md$/, '.ipynb')); throw new Error('A paired notebook already exists.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!await this.plugin.fileSync.createNotebook(kernel, false, file)) throw new Error('Notebook pairing failed.');
 }
 async selectKernel(notePath: string): Promise<void> { this.file(notePath); await this.plugin.selectKernelForNote(notePath); }
 async execute(notePath: string, action: NotebookAction, line?: number, source?: string): Promise<void> {
  const file = this.file(notePath), service = this.plugin.kernelService;
  if (action === 'interrupt') { await service.interrupt(notePath); return; }
  if (action === 'restart') { await service.restart(notePath); return; }
  if (action === 'shutdown') { await service.shutdown(notePath); return; }
  return this.plugin.operations.run(notePath, () => this.executeLocked(notePath, action, line, source));
 }
 private async executeLocked(notePath: string, action: NotebookAction, line?: number, source?: string): Promise<void> {
  const file = this.file(notePath), service = this.plugin.kernelService;
  if (service.contexts.sessions.get(notePath)?.status === 'busy') throw new Error('This notebook is busy. Wait or interrupt it first.');
  if (source !== undefined && action !== 'clear') await this.plugin.app.vault.modify(file, source);
  const ipynbPath = notePath.replace(/\.md$/, '.ipynb');
  if (action === 'clear') {
   const notebook = parseNotebook(await fs.readFile(ipynbPath, 'utf8'));
   for (const cell of notebook.cells.filter(isCodeCell)) { cell.outputs = []; cell.execution_count = null; }
   await fs.writeFile(ipynbPath, JSON.stringify(notebook, null, 2));
  } else {
   const kernel = await service.resolveKernelForNote(notePath);
   if (!kernel) throw new Error('Pair this notebook and select a kernel first.');
   const markdown = await fs.readFile(notePath, 'utf8');
   await runJupytext(this.plugin.settings.toolingPython, ['--update', '--to', 'ipynb', notePath]);
   const notebook = parseNotebook(await fs.readFile(ipynbPath, 'utf8'));
   const fence = line === undefined ? undefined : parseMarkdownCodeFences(markdown).find(item => item.lineStart <= line && item.lineEnd >= line);
   const selected = fence ? getExecutableCellIndex(markdown, fence.lineStart, kernel.language) : null;
   if (action !== 'all' && selected === null) throw new Error('Select an executable code cell.');
   const executable = new Set(getExecutableCellIndices(markdown, kernel.language));
   const blocks = notebook.cells.filter(isCodeCell).flatMap((cell, cellIndex) => {
    if (!executable.has(cellIndex) || action === 'run' && cellIndex !== selected || action === 'above' && cellIndex >= selected! || action === 'below' && cellIndex < selected!) return [];
    return [{cellIndex, code: Array.isArray(cell.source) ? cell.source.join('') : cell.source || ''}];
   });
   await this.plugin.executor.runCodeBlocksAndUpdateNotebook({codeBlocks: blocks, ipynbPath, notePath}, true);
  }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(OUTPUTS_UPDATED_EVENT, {detail: {path: notePath}}));
 }
}
