import {
  HolePunch,
  LinearGradient,
  RadialGradient,
  Rounded,
  RoundedWithBorder,
  RoundedWithBorderAndShadow,
  RoundedWithShadow,
} from '@solid-multiplatform/renderer/webgl/shaders';

export const rendererMajor = 2;

export function rendererOptions<T extends object>(base: T): T {
  return base;
}

const shaderTypes = {
  rounded: Rounded,
  roundedWithBorder: RoundedWithBorder,
  roundedWithShadow: RoundedWithShadow,
  roundedWithBorderWithShadow: RoundedWithBorderAndShadow,
  radialGradient: RadialGradient,
  linearGradient: LinearGradient,
  holePunch: HolePunch,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerShaders(renderer: any): void {
  const shManager = renderer;
  for (const name in shaderTypes) {
    shManager.registerShaderType(
      name,
      shaderTypes[name as keyof typeof shaderTypes],
    );
  }
}
