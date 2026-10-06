import { ok } from '../../utils/response.js';

export default async function healthRoutes(app) {
  app.get('/api/health', async () => {
    const journalMode = app.db.pragma('journal_mode', { simple: true });
    const foreignKeys = app.db.pragma('foreign_keys', { simple: true });
    return ok({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      database: { journalMode, foreignKeys: foreignKeys === 1 },
    });
  });
}
