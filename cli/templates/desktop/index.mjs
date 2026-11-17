import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const executable = new URL(process.platform === 'win32' ? './worker.exe' : './worker', import.meta.url);
export async function run() {
  const { stdout } = await promisify(execFile)(fileURLToPath(executable), [], { timeout: 5000, maxBuffer: 65536 });
  return stdout.trim();
}
