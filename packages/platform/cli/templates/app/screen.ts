export interface ScreenProps {
  /** One control per plugin. */
  names: string[];
  message: string;
  /** Runs a plugin and shows what it returns. */
  onRun(name: string): void;
  /** The target's name and, on native targets, the view native controls go in. */
  target: string;
  native?: object;
}
