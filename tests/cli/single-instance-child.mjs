import { appendFileSync } from 'node:fs';
import { createSingleInstance } from '../../hosts/desktop/single-instance.mjs';

const write = (line) => {
  if (process.env.SI_OUT) appendFileSync(process.env.SI_OUT, line + '\n');
  else console.log(line);
};

const instance = await createSingleInstance({
  name: process.env.SI_NAME,
  args: process.argv.slice(2),
  onActivate(args) {
    write(`activated:${args.join(',')}`);
  },
});
if (!instance.isPrimary) {
  write('secondary');
  process.exit(0);
}
write('primary');
setTimeout(() => {
  write('timeout');
  process.exit(2);
}, 5000);
