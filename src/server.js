import { configuration } from './config.js';
import { createApp } from './app.js';
const config = configuration();
const { app, close } = await createApp(config);
const server = app.listen(config.port, config.host, () => console.log(`Doc-a-Pod: http://localhost:${config.port} (listening on ${config.host})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  server.close(); await close(); server.closeAllConnections();
});
