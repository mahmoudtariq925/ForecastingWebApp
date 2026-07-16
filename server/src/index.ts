import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
app.listen(config.port, () => {
  console.log(`[liquid-api] listening on http://localhost:${config.port}`);
  console.log(`[liquid-api] db: ${config.dbPath}`);
  console.log(`[liquid-api] uploads: ${config.uploadsDir}`);
});
