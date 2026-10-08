import { login } from './auth.controller.js';
import { loginSchema } from './auth.schema.js';

export default async function authRoutes(app) {
  app.post('/api/auth/login', { schema: loginSchema }, login);
}
