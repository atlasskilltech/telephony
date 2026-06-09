'use strict';

// Canonical role slugs used across RBAC, seeders and middleware.
const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMISSION_MANAGER: 'admission_manager',
  TEAM_LEADER: 'team_leader',
  COUNSELOR: 'counselor',
  QA: 'qa',
  MANAGEMENT: 'management',
});

// Admission pipeline stages (also drives the Kanban board order).
const PIPELINE_STAGES = Object.freeze([
  'new_lead',
  'contacted',
  'interested',
  'qualified',
  'application_started',
  'application_submitted',
  'offer_issued',
  'admission_confirmed',
  'enrollment_completed',
]);

const CALL_DIRECTIONS = Object.freeze({ INBOUND: 'inbound', OUTBOUND: 'outbound' });

const CALL_STATUSES = Object.freeze({
  INITIATED: 'initiated',
  RINGING: 'ringing',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  BUSY: 'busy',
  NO_ANSWER: 'no-answer',
  FAILED: 'failed',
  MISSED: 'missed',
});

const ASSIGNMENT_STRATEGIES = Object.freeze({
  ROUND_ROBIN: 'round_robin',
  COURSE_WISE: 'course_wise',
  CITY_WISE: 'city_wise',
  TEAM_WISE: 'team_wise',
  MANUAL: 'manual',
});

const QUEUES = Object.freeze({
  TRANSCRIPTION: 'transcription',
  ANALYSIS: 'analysis',
  QA_AUDIT: 'qa_audit',
  NOTIFICATION: 'notification',
  IMPORT: 'lead_import',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
});

const NOTIFICATION_EVENTS = Object.freeze({
  NEW_LEAD: 'new_lead',
  MISSED_CALL: 'missed_call',
  FOLLOWUP_DUE: 'followup_due',
  ADMISSION_CONVERTED: 'admission_converted',
});

module.exports = {
  ROLES,
  PIPELINE_STAGES,
  CALL_DIRECTIONS,
  CALL_STATUSES,
  ASSIGNMENT_STRATEGIES,
  QUEUES,
  NOTIFICATION_EVENTS,
};
