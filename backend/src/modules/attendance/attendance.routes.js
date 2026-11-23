import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as controller from './attendance.controller.js';
import {
  historySchema,
  listSessionsSchema,
  markPresentSchema,
  punchSchema,
  removeRecordSchema,
  sessionDetailSchema,
  startSchema,
  stopSchema,
} from './attendance.schema.js';

// onRequest hooks run before body parsing/validation and before the controller.
const staffOnly = [authenticate, authorize('teacher', 'admin')];
const studentOnly = [authenticate, authorize('student')];

export default async function attendanceRoutes(app) {
  // Session lifecycle (staff)
  app.post('/api/attendance/start', { onRequest: staffOnly, schema: startSchema }, controller.startSession);
  app.post('/api/attendance/stop', { onRequest: staffOnly, schema: stopSchema }, controller.stopSession);

  // Student actions
  app.post('/api/attendance/punch', { onRequest: studentOnly, schema: punchSchema }, controller.punch);
  app.get('/api/attendance/active', { onRequest: studentOnly }, controller.activeSessions);
  app.get('/api/attendance/me', { onRequest: studentOnly, schema: historySchema }, controller.myHistory);

  // Staff queries and manual corrections
  app.get('/api/attendance/sessions', { onRequest: staffOnly, schema: listSessionsSchema }, controller.listSessions);
  app.get('/api/attendance/sessions/:sessionId', { onRequest: staffOnly, schema: sessionDetailSchema }, controller.sessionDetail);
  app.post('/api/attendance/sessions/:sessionId/records', { onRequest: staffOnly, schema: markPresentSchema }, controller.markPresent);
  app.delete(
    '/api/attendance/sessions/:sessionId/records/:studentId',
    { onRequest: staffOnly, schema: removeRecordSchema },
    controller.removeRecord,
  );
}
