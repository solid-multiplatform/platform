export function runAndroidTV(loadApp: (host: { target: 'android-tv'; root: object; canvas: object }) => Promise<{ mount(): () => void }>): void;
