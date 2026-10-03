# Notebook API v1

JupyMD 2.1.0 exposes `plugin.api`. Listen for workspace events `jupymd:api-ready` and `jupymd:api-unload`, and also inspect the currently loaded plugin when attaching. Dispose registrations when either plugin unloads. All notebook arguments are absolute paths to Markdown notes inside the active vault.

- `registerExecutionContextResolver(owner, async notePath => ({cwd}) | null)` returns an unregister function. Return null for unowned notebooks. An invalid owned directory must reject, preventing execution. Conflicting providers reject.
- `subscribe(listener)` returns an unsubscribe function for session changes.
- `getSessions()` returns notebook path, kernel name, startup cwd, and busy/idle/restart-required/error status.
- `listKernels()` returns discovered kernel connections.
- `pair(notePath, kernel)` creates the paired notebook and refuses existing destinations.
- `selectKernel(notePath)` opens the kernel selection flow for that note.
- `execute(notePath, action, line?, source?)` supports run/all/above/below/interrupt/restart/shutdown/clear. Cell actions use a zero-based Markdown source line and JupyMD’s executable-cell mapping. Source, if supplied for execution, is the caller’s current notebook snapshot and is persisted before synchronization. Callers must validate their snapshot after any asynchronous user interaction.

## Project environments and the shared kernel picker

The project-environment extension remains API v1. Feature-detect both `api.capabilities?.projectEnvironments === true` and `api.capabilities?.kernelPicker === true`, plus `typeof api.pickKernel === 'function'`. Older 2.1.0 builds expose API v1 without these capabilities; checking `apiVersion` alone is insufficient. These additions require the updated JupyMD build.

Context resolvers can now return:

```ts
type NotebookExecutionContext = {
  cwd: string;
  projectRoot?: string;
  environmentError?: string;
  environment?: {
    language: string;
    executable: string;
    label?: string;
  };
};
```

`cwd` is the kernel startup directory. `projectRoot` is the associated repository root, independent of the startup-directory preference. `environment` is the companion's resolved preferred runtime, including explicit note/project selections. The executable must be an absolute path. Directory fields must refer to existing directories, and the project root must be absolute. A missing interpreter remains visible as unavailable; it is not replaced with global Python. Conflicting provider directories, roots, or runtimes reject. Existing resolvers returning only `{cwd}` remain compatible.

Recommendation failures (ambiguous discovery, invalid profile selections, or unavailable interpreter commands) should return `environmentError` with actionable text and omit `environment`. The shared chooser displays this diagnostic while retaining Python-environment and installed-kernel choices. It does not invalidate a selected kernel or a running session; execution, restart, and session inspection continue to validate their directories. Providers must still reject invalid directories rather than converting them into recommendation diagnostics. Diagnostics participate in picker snapshot revalidation.

When startup is configured as “notebook,” return the notebook's parent directory as `cwd` while still providing the repository root and environment. Return null only for notebooks the provider does not own. Resolve the preferred environment without following an already selected JupyMD kernel back into the preference; otherwise a mismatch would disappear and selection could become circular.

Python environments supplied by a provider appear first in the kernel-source picker. The Python-environments picker also includes virtual environments directly inside the supplied project root; discovery does not recursively scan repositories or infer monorepo environment precedence. Selection validates the interpreter and asks before installing missing IPyKernel. Other languages retain the installed-kernel selection flow. A known mismatch is displayed, but existing notebook metadata and running sessions are not changed automatically. JupyMD's tooling Python is independent of the preferred execution interpreter.

```ts
const kernel = await api.pickKernel(absoluteNotePath, {
  preferredLanguage: 'python',
  context: {
    cwd: startupDirectory,
    projectRoot: repository,
    environment: {language: 'python', executable: projectPython, label: projectName},
  },
});
if (!kernel) return; // User cancelled; no notebook was created or changed.
// Validate the caller's project/configuration snapshot after the asynchronous picker.
// Then create the Markdown note and pair it, preserving the full returned connection.
await api.pair(absoluteNotePath, kernel);
```

`pickKernel(notePath, options?: {preferredLanguage?: string; context?: NotebookExecutionContext})` returns `Promise<KernelConnection | null>`. The note path must be an absolute `.md` path inside the vault, but the note and paired notebook need not exist yet. Its default parent startup directory must exist, or an explicit context must provide an existing startup directory. An explicit context is useful before a project folder is associated with a note; it applies only to this picker call. Without it, the registered providers resolve the note's context. The picker validates the context again before returning a selection and rejects provider changes during the interaction. With an explicit context, the caller must revalidate its own settings snapshot; the picker cannot observe a replacement in the companion's settings.

The picker does not pair a notebook, change its selected kernel, start a kernel session, switch tooling Python, or use the active leaf. It may create a vault-local managed kernelspec for a chosen Python environment and install IPyKernel only after user confirmation. Preserve the entire returned `KernelConnection` when passing it to `pair`; do not narrow it to a display-name-only object. For an existing paired note, `selectKernel(notePath)` opens the same picker and applies an explicit user selection.

Execution and notebook mutations serialize per notebook; separate notebooks run independently. The cwd is applied only at startup and explicit restart. A changed configured cwd requires restart; code may change the process cwd within an existing session. Restart and shutdown discard variables, so callers should obtain user confirmation. There are no implicit installations, remote services, or changes to selected interpreters.
