// Preload beside the desktop launcher. Wait for the host, audit the AccessKit
// node set, print it and close. Run with the packaged desktop app.
import { channel } from 'node:diagnostics_channel';

let done = false;
channel('solid.desktop.host').subscribe((host) => {
  setTimeout(() => {
    if (done) return;
    done = true;
    const issues = host.semantics.audit?.() ?? [];
    console.log(JSON.stringify({ accessibility: issues }));
    process.emit('SIGTERM');
  }, 500);
});
setTimeout(() => {
  if (!done) {
    console.log(JSON.stringify({ accessibility: null, reason: 'no-host' }));
    process.exit(1);
  }
}, 10000).unref();
