const path = require('node:path');
const webpack = require('@nativescript/webpack');
const {
  chainSolidTV,
} = require('@solid-multiplatform/platform/nativescript/webpack');

module.exports = (env) => {
  webpack.init(env);
  webpack.chainWebpack((config) => {
    // The target folds the touch scroller out of this TV bundle.
    chainSolidTV(config, { target: 'android-tv' });
    config.plugin('CopyWebpackPlugin').tap((args) => {
      args[0].patterns.push({
        from: path.resolve(__dirname, '../../tests/webgl/fonts'),
        to: 'fonts',
      });
      return args;
    });
    const modules = path.resolve(__dirname, 'node_modules');
    config.resolve.modules.prepend(modules);
    config.resolve.alias.set('@nativescript/canvas-gamepad', false);
    config.plugins.delete('ForkTsCheckerWebpackPlugin');
  });
  return webpack.resolveConfig();
};
