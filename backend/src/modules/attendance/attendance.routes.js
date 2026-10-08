import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { startSession } from './attendance.controller.js';

export default async function attendanceRoutes(app) {
  // onRequest hooks run before body parsing/validation and before the controller.
  app.post(
    '/api/attendance/start',
    { onRequest: [authenticate, authorize('teacher', 'admin')] },
    startSession,
  );
}
