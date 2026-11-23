export type Role = 'student' | 'teacher' | 'admin';
export interface User {
  id: string;
  role: Role;
  full_name: string;
  email: string;
}
export interface Auth {
  user: User;
  token: string;
}
export interface Course {
  id: string;
  course_code: string;
  title: string;
  teacher_id: string;
}
export interface Student {
  student_id: string;
  full_name: string;
  email: string;
}
export interface Present extends Student {
  punched_at: string;
  manual: 0 | 1 | boolean;
}
export interface Session {
  id: string;
  course_id: string;
  is_active: boolean;
  started_at: string;
  ended_at: string | null;
  otp_code?: string;
  attendance_count?: number;
}
export interface ActiveSession {
  session_id: string;
  course_id: string;
  course_code: string;
  title: string;
  started_at: string;
  already_punched: boolean;
}
export interface SessionDetail {
  session: Session;
  present: Present[];
  absent: Student[];
}
export type Tier = 'Excellent' | 'Satisfactory' | 'Warning' | 'Critical';
export interface Summary {
  course_id: string;
  course_code: string;
  title: string;
  total_sessions: number;
  sessions_attended: number;
  attendance_percentage: number;
  tier?: Tier;
}
export interface Attendance {
  courses: Summary[];
  records: {
    session_id: string;
    course_id: string;
    course_code: string;
    session_started_at: string;
    punched_at: string;
  }[];
}
export type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
