import { AuthenticationError } from '../utils/errors.js';
import { ROLES } from '../utils/roles.js';

/**
 * Fastify hook (use in `onRequest`, so it runs before body parsing, validation
 * and the controller). Verifies the Bearer JWT and exposes the payload as request.user.
 * Every failure is a 401; no token internals are returned to the client.
 */
export async function authenticate(request) {
  try {
    await request.jwtVerify();
  } catch (err) {
    if (err.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') throw new AuthenticationError('Token expired');
    throw new AuthenticationError('Authentication required');
  }
  // A correctly signed token must still carry the claims the app depends on.
  const { sub, role } = request.user ?? {};
  if (typeof sub !== 'string' || sub === '' || !ROLES.includes(role)) {
    throw new AuthenticationError('Invalid token');
  }
}
