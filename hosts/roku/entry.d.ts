declare module 'solid-app-entry' {
  export function mount(host: {
    target: 'roku';
    root: object;
    textEntry?: import('./native-text-types').NativeTextPort;
    video?: import('./video-bridge').RokuVideoApi;
  }): () => void;
}
