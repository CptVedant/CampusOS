import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { ROLES } from '../utils/roles.js';

/**
 * authorize('teacher', 'admin') returns a hook that allows only the listed roles.
 * Roles are never implied: listing 'teacher' does not admit 'admin', and vice versa.
 * Must run after authenticate(); if it didn't, it fails closed with 401.
 */
export function authorize(...allowedRoles) {
  if (allowedRoles.length === 0 || allowedRoles.some((r) => !ROLES.includes(r))) {
    throw new Error(`authorize() requires one or more of: ${ROLES.join(', ')}`);
  }
  return async function authorizeHook(request) {
    const role = request.user?.role;
    if (!role) throw new AuthenticationError('Authentication required');
    if (!allowedRoles.includes(role)) throw new AuthorizationError('Insufficient permissions');
  };
}
