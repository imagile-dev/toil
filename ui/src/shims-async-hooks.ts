/**
 * Stands in for `node:async_hooks` in the page's own build (vite.config.ts), and nowhere else. A few of toil's pure modules the
 * page reads (the scheme reader, by way of the secret check and the HTTP helpers it shares) import toil's progress listener,
 * which makes an `AsyncLocalStorage` when it loads. The page never runs a command, so no progress event is ever reported in it
 * and nothing is ever stored; this keeps the module loadable and does what that class does in one synchronous stack, which is
 * all a browser has. The server and the tests use Node's own. A form for the progress that nobody is making.
 */
export class AsyncLocalStorage<T> {
  private value: T | undefined;

  run<R>(store: T, callback: () => R): R {
    const before = this.value;
    this.value = store;
    try {
      return callback();
    } finally {
      this.value = before;
    }
  }

  getStore(): T | undefined {
    return this.value;
  }
}
