import Fastify from 'fastify';
import { createErrorHandler, notFoundHandler } from './utils/errors.js';
import healthRoutes from './modules/health/health.routes.js';

/**
 * Builds the Fastify instance. Config and db are injected (not imported) so tests
 * can run against a temporary database without touching real environment variables.
 */
export function buildApp({ config, db }) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    disableRequestLogging: config.isProduction,
  });

  app.decorate('db', db);
  app.decorate('config', config);

  app.setErrorHandler(createErrorHandler(config));
  app.setNotFoundHandler(notFoundHandler);

  app.register(healthRoutes);

  return app;
}
