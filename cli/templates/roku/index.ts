import { postComponentTask } from '@solid-multiplatform/platform/roku/tasks';
export function run(): Promise<string> {
  return postComponentTask<string>('__CLASS__Task', { op: 'run' }).result;
}
