import * as path from 'path';
import * as fs from 'fs/promises';
export type NotebookEnvironment = {language: string; executable: string; label?: string};
export type NotebookExecutionContext = {cwd: string; projectRoot?: string; environment?: NotebookEnvironment; environmentError?: string};
export type ExecutionContextResolver = (notePath: string) => Promise<NotebookExecutionContext | null>;
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
 async resolve(notePath: string): Promise<NotebookExecutionContext> {
  let selected: NotebookExecutionContext | undefined;
  for (const resolver of this.resolvers.values()) {
   const result = await resolver(notePath);
   if (!result) continue;
   if (selected && selected.cwd !== result.cwd) throw new Error('Conflicting notebook execution contexts.');
   if (selected?.projectRoot && result.projectRoot && selected.projectRoot !== result.projectRoot) throw new Error('Conflicting notebook project roots.');
   if (selected?.environment && result.environment &&
       (selected.environment.language !== result.environment.language || selected.environment.executable !== result.environment.executable)) {
    throw new Error('Conflicting notebook environments.');
   }
   selected = {cwd: result.cwd, projectRoot: result.projectRoot ?? selected?.projectRoot, environment: result.environment ?? selected?.environment,
    ...((result.environmentError || selected?.environmentError) ? {environmentError: [selected?.environmentError, result.environmentError].filter(Boolean).join('\n')} : {})};
  }
  return this.validate(selected ?? {cwd: path.dirname(notePath)});
 }
 async validate(context: NotebookExecutionContext): Promise<NotebookExecutionContext> {
  const directory = await fs.realpath(context.cwd);
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('Notebook startup directory is unavailable.');
  let projectRoot: string | undefined;
  if (context.projectRoot !== undefined) {
   if (!path.isAbsolute(context.projectRoot)) throw new Error('Notebook project root must be an absolute path.');
   projectRoot = await fs.realpath(context.projectRoot);
   if (!(await fs.stat(projectRoot)).isDirectory()) throw new Error('Notebook project root is unavailable.');
  }
  const environment = context.environment;
  if (environment && (!environment.language?.trim() || !path.isAbsolute(environment.executable))) {
   throw new Error('Notebook environment requires a language and an absolute executable path.');
  }
  if (context.environmentError !== undefined && typeof context.environmentError !== 'string') throw new Error('Notebook environment diagnostic must be text.');
  return {cwd: directory, projectRoot, environment: environment ? {...environment} : undefined,
   ...(context.environmentError ? {environmentError: context.environmentError} : {})};
 }
 async directory(notePath: string): Promise<string> {
  return (await this.resolve(notePath)).cwd;
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
