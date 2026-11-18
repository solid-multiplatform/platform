export function runIOS(
  loadApp: (host: {
    target: 'ios';
    root: object;
    canvas: object;
  }) => Promise<{ mount(): () => void }>,
): void;
