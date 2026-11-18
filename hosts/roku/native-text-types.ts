export interface NativeTextRequest {
  title: string;
  initial: string;
  numeric: boolean;
  secret: boolean;
  /** Roku voice keyboard domain. */
  domain?: 'generic' | 'email' | 'alphanumeric' | 'numeric' | 'password';
  /** Allow Roku voice dictation. Defaults to true. */
  voice?: boolean;
  maximumLength: number;
  confirm: string;
  change: (value: string) => void;
  done: (value: string) => void;
  cancel: () => void;
  failed: () => void;
}

export interface NativeTextPort {
  open(request: NativeTextRequest): { close(): void };
  ownsInput(): boolean;
}
