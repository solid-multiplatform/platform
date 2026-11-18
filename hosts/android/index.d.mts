export function runAndroid(
  loadApp: (host: {
    target: 'android';
    root: object;
    canvas: object;
  }) => Promise<{ mount(): () => void }>,
): void;
