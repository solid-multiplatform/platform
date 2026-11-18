import type { ElementNode } from '@solid-multiplatform/platform';
import type { Viewport } from '@solid-multiplatform/platform/viewport';
export interface ScreenHost {
  target: string;
  root?: object;
  semantics?: {
    register(
      value: import('@solid-multiplatform/platform/semantics').Semantics,
    ): { dispose(): void; focus?(): void };
  };
}
export interface ScreenProps {
  host?: ScreenHost;
  names: string[];
  message(): string;
  viewport(): Viewport;
  register(name: string, node: ElementNode): void;
  activate(name: string): true;
  next(offset: number): true;
}
