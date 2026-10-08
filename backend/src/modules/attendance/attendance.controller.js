import { AppError } from '../../utils/errors.js';

// PLACEHOLDER (Phase 2): exists only so RBAC on POST /api/attendance/start can be tested.
// The real implementation (OTP generation, session creation) arrives in Phase 4.
export async function startSession() {
  throw new AppError(501, 'NOT_IMPLEMENTED', 'Attendance start is not implemented yet');
}
