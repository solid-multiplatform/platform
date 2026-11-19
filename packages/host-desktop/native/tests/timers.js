var order = [];
setTimeout(function () {
  order.push('t50');
}, 50);
setTimeout(function () {
  order.push('t10');
  Promise.resolve().then(function () {
    order.push('micro-after-t10');
  });
}, 10);
var cancelled = setTimeout(function () {
  order.push('never');
}, 20);
clearTimeout(cancelled);
Promise.resolve().then(function () {
  order.push('micro-first');
});
setTimeout(function () {
  print(order.join(','));
  __solid.exit(
    order.join(',') === 'micro-first,t10,micro-after-t10,t50' ? 0 : 3,
  );
}, 80);
