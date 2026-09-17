import * as fs from "fs/promises";
import * as path from "path";
import {execFile} from "child_process";
import {promisify} from "util";
import {JupyterBridgeClient} from "../bridge/JupyterBridgeClient";
import {KernelConnection, KernelExecutionResult} from "./types";
import {ManagedKernelSpecStore} from "./ManagedKernelSpecStore";
import {parseNotebook} from "../components/types";

import {ExecutionContexts} from "./ExecutionContexts";

const execFileAsync = promisify(execFile);

export class NotebookKernelService {
 readonly contexts = new ExecutionContexts();
 private queues = new Map<string, Promise<unknown>>();
 private disposed = false;
	constructor(
		private readonly bridge: JupyterBridgeClient,
		private readonly managedSpecs: ManagedKernelSpecStore
	) {}

	async listKernels(): Promise<KernelConnection[]> {
		return this.bridge.listKernels();
	}

	async resolveKernelForNote(notePath: string): Promise<KernelConnection | null> {
		const ipynbPath = notePath.replace(/\.md$/, ".ipynb");
		let notebook;
		try {
			notebook = parseNotebook(await fs.readFile(ipynbPath, "utf-8"));
		} catch {
			return null;
		}

		const kernelName = notebook?.metadata?.kernelspec?.name;
		if (!kernelName) return null;

		const kernels = await this.listKernels();
		return kernels.find((kernel) => kernel.name.toLowerCase() === String(kernelName).toLowerCase()) || null;
	}

	async setKernelForNote(notePath: string, kernel: KernelConnection): Promise<void> {
  if (this.queues.has(notePath)) throw new Error('Interrupt the notebook and wait before changing its kernel.');
		const ipynbPath = notePath.replace(/\.md$/, ".ipynb");
		const notebook = parseNotebook(await fs.readFile(ipynbPath, "utf-8"));
		notebook.metadata = notebook.metadata || {};
		notebook.metadata.kernelspec = {
			display_name: kernel.displayName,
			language: kernel.language,
			name: kernel.name,
		};
		await fs.writeFile(ipynbPath, JSON.stringify(notebook, null, 2), "utf-8");
		await this.shutdown(notePath);
	}

	async preparePythonEnvironment(pythonPath: string, label?: string): Promise<KernelConnection> {
		await execFileAsync(pythonPath, ["-c", "import ipykernel"], {timeout: 5000});
		const {stdout} = await execFileAsync(
			pythonPath,
			["-c", "import sys; print(sys.executable)"],
			{timeout: 5000}
		);
		const resolvedPath = path.resolve(stdout.trim() || pythonPath);
		let kernels = await this.listKernels();
		let matchingKernel = kernels.find((kernel) =>
			kernel.interpreterPath && path.resolve(kernel.interpreterPath) === resolvedPath
		);
		if (matchingKernel) return matchingKernel;

		await this.managedSpecs.ensurePythonKernel(resolvedPath, label);
		kernels = await this.listKernels();
		matchingKernel = kernels.find((kernel) =>
			kernel.interpreterPath && path.resolve(kernel.interpreterPath) === resolvedPath
		);
		if (!matchingKernel) {
			throw new Error("The Python kernel was created but could not be discovered.");
		}
		return matchingKernel;
	}

	async execute(notePath: string, code: string): Promise<KernelExecutionResult> {
  const operation = (this.queues.get(notePath) || Promise.resolve()).catch(() => {}).then(async () => {
   if (this.disposed) throw new Error('Notebook services are stopped.');
   const kernel = await this.resolveKernelForNote(notePath);
   if (!kernel) throw new Error('No usable Jupyter kernel is selected for this notebook.');
   const cwd = await this.contexts.directory(notePath);
   const previous = this.contexts.sessions.get(notePath);
   if (previous && previous.cwd !== cwd) throw new Error('Startup directory changed. Restart this notebook kernel before running.');
   const session = {notePath, kernel: kernel.name, cwd, status: 'busy' as const};
   this.contexts.sessions.set(notePath, session); this.contexts.changed();
   try {
    const result = await this.bridge.execute(notePath, kernel.name, cwd, code);
    this.contexts.sessions.set(notePath, {...session, status: 'idle'}); return result;
   } catch (error) { this.contexts.sessions.set(notePath, {...session, status: 'error'}); throw error; }
   finally { this.contexts.changed(); }
  });
  this.queues.set(notePath, operation);
  try { return await operation; } finally { if (this.queues.get(notePath) === operation) this.queues.delete(notePath); }
 }

	async interrupt(notePath: string): Promise<boolean> {
		return this.bridge.interrupt(notePath);
	}

	async restart(notePath: string): Promise<boolean> {
		if (this.queues.has(notePath)) throw new Error('Interrupt the notebook and wait for it to stop before restarting.');
  const cwd = await this.contexts.directory(notePath);
  const restarted = await this.bridge.restart(notePath, cwd);
  const session = this.contexts.sessions.get(notePath);
  if (session && restarted) this.contexts.sessions.set(notePath, {...session, cwd, status: 'idle'});
  this.contexts.changed(); return restarted;
	}

	async shutdown(notePath: string): Promise<void> {
		if (this.queues.has(notePath)) throw new Error('Interrupt the notebook and wait for it to stop before shutting down.');
  await this.bridge.shutdown(notePath);
  this.contexts.sessions.delete(notePath); this.contexts.changed();
	}

	async dispose(): Promise<void> {
		this.disposed = true; await this.bridge.dispose(); this.contexts.dispose();
	}
}
