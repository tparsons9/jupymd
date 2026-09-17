/** Serializes notebook file mutations while allowing separate notebooks to run concurrently. */
export class NotebookOperations {
 private pending = new Map<string, Promise<unknown>>();
 async run<T>(notePath: string, action: () => Promise<T>): Promise<T> {
  const operation = (this.pending.get(notePath) || Promise.resolve()).catch(() => {}).then(action);
  this.pending.set(notePath, operation);
  try { return await operation; } finally { if (this.pending.get(notePath) === operation) this.pending.delete(notePath); }
 }
}
