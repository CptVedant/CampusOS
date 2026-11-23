import { ok } from '../../utils/response.js';
import * as attendance from './attendance.service.js';

export async function startSession(request, reply) {
  const session = attendance.startSession(request.server.db, request.user, request.body.course_id);
  return reply.code(201).send(ok(session));
}

export async function stopSession(request) {
  return ok(attendance.stopSession(request.server.db, request.user, request.body.session_id));
}

export async function punch(request, reply) {
  const result = attendance.punchAttendance(request.server.db, request.user, request.body);
  return reply.code(201).send(ok(result));
}

export async function activeSessions(request) {
  return ok(attendance.listActiveSessionsForStudent(request.server.db, request.user.sub));
}

// Identity comes from the JWT only; no student id is accepted.
export async function myHistory(request) {
  return ok(attendance.getStudentHistory(request.server.db, request.user.sub, request.query.course_id ?? null));
}

export async function listSessions(request) {
  return ok(attendance.listSessions(request.server.db, request.user, request.query.course_id));
}

export async function sessionDetail(request) {
  return ok(attendance.getSessionDetail(request.server.db, request.user, request.params.sessionId));
}

export async function markPresent(request, reply) {
  const row = attendance.markPresent(request.server.db, request.user, request.params.sessionId, request.body.student_id);
  return reply.code(201).send(ok(row));
}

export async function removeRecord(request) {
  const { sessionId, studentId } = request.params;
  return ok(attendance.removeRecord(request.server.db, request.user, sessionId, studentId));
}
