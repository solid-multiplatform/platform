// What a script's mistakes look like from outside: each kind is reported on
// standard error with a stack trace, and the loop goes on. run.sh checks the
// output.
function inATimer() {
  throw new Error('thrown in a timer');
}
setTimeout(inATimer, 0);
requestAnimationFrame(function inAFrame() {
  null.property;
});
function rejecting() {
  return Promise.reject(new TypeError('rejected and never handled'));
}
rejecting();
// A rejection that is handled in time is not reported.
var late = Promise.reject(new Error('handled late'));
setTimeout(function () {
  late.catch(function () {});
}, 20);
console.log('to standard output', { answer: 42 });
console.warn('to standard error');
setTimeout(function () {
  __solid.exit(0);
}, 300);
