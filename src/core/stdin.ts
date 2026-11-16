import { readSync } from 'node:fs';

/**
 * Everything on a file descriptor up to end of file, read synchronously, for
 * `-` (stdin) on the CLI.
 *
 * `readFileSync(0)` is not enough. Once anything touches `process.stdin` (the
 * CLI asks whether it's a terminal), Node puts a piped stdin into
 * non-blocking mode, and a read that arrives before the writer upstream has
 * produced anything fails with EAGAIN instead of waiting: `toil deps scan |
 * toil osv vulns` lost that race every time. So on EAGAIN this waits a moment
 * and reads again, until the writer closes its end. The pipe, like every
 * queue, rewards whoever is prepared to stand in it.
 *
 * It blocks the thread while it waits, as `readFileSync` would on a blocking
 * pipe; Ctrl+C in a pipeline ends the writer too, which closes the pipe and
 * ends the wait.
 */
export function readAllSync(fd: number, io: { read?: (fd: number, buffer: Buffer) => number; sleep?: (ms: number) => void } = {}): Buffer {
  const read = io.read ?? ((f: number, b: Buffer) => readSync(f, b, 0, b.length, null));
  const sleep = io.sleep ?? sleepSync;
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);
  for (;;) {
    let n: number;
    try {
      n = read(fd, buffer);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EAGAIN') {
        sleep(10);
        continue;
      }
      // Windows reports a pipe whose writer has gone as EOF, not as an error.
      if ((err as NodeJS.ErrnoException).code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

const pause = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  Atomics.wait(pause, 0, 0, ms);
}
