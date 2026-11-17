import type { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'dev.solidmultiplatform.fixture',
  projectName: 'SolidMultiplatform',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  bundler: 'webpack',
  cli: { packageManager: 'pnpm' },
} as NativeScriptConfig;
