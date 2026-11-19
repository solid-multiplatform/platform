// A script that throws while it starts never ran: the process must say so
// and exit with a failure. run.sh checks both.
function start() {
  throw new RangeError('cannot start');
}
start();
