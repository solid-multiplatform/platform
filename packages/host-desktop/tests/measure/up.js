// The runtime alone: the window, the GL context, the engine and its prelude
// are up when this runs.
print('MEASURE ' + JSON.stringify({ up: performance.now() }));
__solid.exit(0);
