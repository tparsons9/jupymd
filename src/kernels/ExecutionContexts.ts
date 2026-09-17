import * as path from 'path';
import * as fs from 'fs/promises';
export type ExecutionContextResolver = (notePath: string) => Promise<{cwd: string} | null>;
export type NotebookSession = {notePath: string; kernel: string; cwd: string; status: 'busy' | 'idle' | 'restart-required' | 'error'};
export class ExecutionContexts {
 private resolvers = new Map<string, ExecutionContextResolver>();
 private listeners = new Set<() => void>();
 readonly sessions = new Map<string, NotebookSession>();
 register(owner: string, resolver: ExecutionContextResolver): () => void {
  if (this.resolvers.has(owner)) throw new Error('Execution context provider already registered.');
  this.resolvers.set(owner, resolver); this.changed();
  return () => { if (this.resolvers.get(owner) === resolver) this.resolvers.delete(owner); this.changed(); };
 }
 async directory(notePath: string): Promise<string> {
  let selected: string | undefined;
  for (const resolver of this.resolvers.values()) {
   const result = await resolver(notePath);
   if (result) { if (selected && selected !== result.cwd) throw new Error('Conflicting notebook execution contexts.'); selected = result.cwd; }
  }
  const directory = await fs.realpath(selected || path.dirname(notePath));
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Notebook startup directory is unavailable.');
  return directory;
 }
 subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
 changed(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Consumers cannot disrupt execution. */ } } }
 async list(): Promise<NotebookSession[]> {
  return Promise.all([...this.sessions.values()].map(async session => {
   try { return {...session, status: await this.directory(session.notePath) === session.cwd ? session.status : 'restart-required' as const}; }
   catch { return {...session, status: 'error' as const}; }
  }));
 }
 dispose(): void { this.resolvers.clear(); this.sessions.clear(); this.changed(); this.listeners.clear(); }
}
