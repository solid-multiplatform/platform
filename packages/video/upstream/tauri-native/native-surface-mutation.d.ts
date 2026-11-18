import type { NativeCssSurfaceState } from './native-surface-state';
export declare function stylesheetMutation(record: MutationRecord): boolean;
export declare function structuralMutation(record: MutationRecord, state: NativeCssSurfaceState): boolean;
export declare function nativeCoordinateMutation(record: MutationRecord): boolean;
export declare function withoutNativeCoordinates(style: string): string;
export declare function mutationContains(record: MutationRecord, anchor: HTMLElement): boolean;
