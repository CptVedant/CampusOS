import { ok } from '../../utils/response.js';
import { verifyCredentials } from './auth.service.js';

export async function login(request, reply) {
  const user = await verifyCredentials(request.server.db, request.body);
  // Payload is deliberately minimal: identity (sub) + role. exp/iat are added by the signer.
  const token = await reply.jwtSign({ sub: user.id, role: user.role });
  return ok({ token, user });
}
