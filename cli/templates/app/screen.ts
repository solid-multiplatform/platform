import type { ElementNode } from '@solid-multiplatform/platform';
import type { Viewport } from '@solid-multiplatform/platform/viewport';
export interface ScreenProps {
  names: string[];
  message(): string;
  viewport(): Viewport;
  register(name: string, node: ElementNode): void;
  activate(name: string): true;
  next(offset: number): true;
}
