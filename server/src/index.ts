import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
app.listen(config.port, () => {
  console.log(`[liquid-api] listening on http://localhost:${config.port}`);
  console.log(`[liquid-api] storage provider: ${config.storageProvider}`);
  if (config.storageProvider === 'local') console.log(`[liquid-api] storage dir: ${config.storageDir}`);
  if (config.storageProvider === 'sqlite') console.log(`[liquid-api] sqlite: ${config.sqlitePath}`);
});
