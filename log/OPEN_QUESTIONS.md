# Backend and deployment follow-ups

- Student search has no route. Enrollment uses the student UUID until a search contract is available.
- Materials, assessments, marks, and listing users have no available API contracts. The UI uses local demo data and does not send writes for these screens. Admin course management uses the real course routes.
- Attendance tier thresholds are provisional. When the backend begins sending a tier, the frontend shows Pending check on disagreement and reports it to the development console. A logging endpoint is pending.
- Confirm production SPA fallback, static hosting, compression, and CSP with the backend owner.
