// Read-only ECP device check. Does not install or replace the channel.
const ip = process.env.ROKU_DEV_IP;
if (!ip) {
  console.log(JSON.stringify({ roku: false, reason: 'ROKU_DEV_IP missing' }));
  process.exit(0);
}
const get = async (path) => {
  const response = await fetch(`http://${ip}:8060${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
};
const tag = (xml, name) =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;
try {
  const info = await get('/query/device-info');
  const active = await get('/query/active-app');
  const media = await get('/query/media-player');
  console.log(
    JSON.stringify({
      roku: true,
      model: tag(info, 'model-name'),
      software: tag(info, 'software-version'),
      power: tag(info, 'power-mode'),
      activeApp: tag(active, 'app'),
      mediaState: tag(media, 'state'),
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ roku: false, reason: error.message }));
  process.exitCode = 1;
}
