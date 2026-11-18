export function runAppleTV(loadApp: (host: { target: 'apple-tv'; root: object; canvas: object }) => Promise<{ mount(): () => void }>): void;
