# Notebook API v1

JupyMD 2.1.0 exposes `plugin.api`. Listen for workspace events `jupymd:api-ready` and `jupymd:api-unload`, and also inspect the currently loaded plugin when attaching. Dispose registrations when either plugin unloads. All notebook arguments are absolute paths to Markdown notes inside the active vault.

- `registerExecutionContextResolver(owner, async notePath => ({cwd}) | null)` returns an unregister function. Return null for unowned notebooks. An invalid owned directory must reject, preventing execution. Conflicting providers reject.
- `subscribe(listener)` returns an unsubscribe function for session changes.
- `getSessions()` returns notebook path, kernel name, startup cwd, and busy/idle/restart-required/error status.
- `listKernels()` returns discovered kernel connections.
- `pair(notePath, kernel)` creates the paired notebook and refuses existing destinations.
- `selectKernel(notePath)` opens the kernel selection flow for that note.
- `execute(notePath, action, line?, source?)` supports run/all/above/below/interrupt/restart/shutdown/clear. Cell actions use a zero-based Markdown source line and JupyMD’s executable-cell mapping. Source, if supplied for execution, is the caller’s current notebook snapshot and is persisted before synchronization. Callers must validate their snapshot after any asynchronous user interaction.

Execution and notebook mutations serialize per notebook; separate notebooks run independently. The cwd is applied only at startup and explicit restart. A changed configured cwd requires restart; code may change the process cwd within an existing session. Restart and shutdown discard variables, so callers should obtain user confirmation. There are no implicit installations, remote services, or changes to selected interpreters.
