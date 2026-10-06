import 'dotenv/config';
import path from 'node:path';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = process.env.JWT_SECRET ?? 'CHANGE_ME';

if (nodeEnv === 'production' && (jwtSecret === 'CHANGE_ME' || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production');
}

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

export const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port,
  host: process.env.HOST ?? '0.0.0.0',
  databasePath: path.resolve(process.env.DATABASE_PATH ?? './data/sms.sqlite'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  logLevel: process.env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
});
