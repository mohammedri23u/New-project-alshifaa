/* ============================================================================
 * EXAMPLE — a complete, working 2-day course.
 *
 * Copy this file over the one in the project root to try it:
 *     cp EXAMPLE/course.config.js  course.config.js
 *     cp EXAMPLE/questions.csv     content/questions.csv
 *     cp EXAMPLE/feedback.csv      content/feedback.csv
 *
 * Every window below is deliberately open from 2026 to 2030, so the portal
 * works the moment you deploy it and you can click through the whole flow
 * without touching the admin console first.
 *
 * FOR A REAL COURSE, narrow the windows to your actual dates — see the
 * "windows" block near the bottom. Leaving them wide open means a learner
 * could sit the post-test before the course starts.
 * ==========================================================================*/

var COURSE_CONFIG = {

  courseName: 'Introduction to Research Data Management',
  courseShortName: 'RDM Basics',
  organisation: 'Example University, Faculty of Health Sciences',
  contactEmail: 'rdm-course@example.edu',

  language: 'en',
  timezone: 'Europe/London',
  participantCodePrefix: 'RDM',

  /* A two-day course. */
  days: [
    { index: 1, title: 'Day 1 — Planning and organising data', date: '2026-10-05' },
    { index: 2, title: 'Day 2 — Sharing and preserving data',   date: '2026-10-06' }
  ],

  windows: {
    // Wide open so the example works immediately. NARROW THESE FOR A REAL COURSE:
    //   pre:  { opensAt: '2026-10-01T00:00', closesAt: '2026-10-05T09:30' },
    //   post: { opensAt: '2026-10-06T15:00', closesAt: '2026-10-09T23:59' },
    registration: { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' },
    pre:          { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' },
    post:         { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' },
    feedback:     { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' },
    attendance_1: { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' },
    attendance_2: { opensAt: '2026-01-01T00:00', closesAt: '2030-12-31T23:59' }
  },

  /* Both days, both tests and the feedback form. A demanding rule on purpose,
     so you can watch the eligibility panel change as you complete each part. */
  certificate: {
    requiredComponents: ['registration', 'pre', 'post', 'feedback'],
    minAttendanceDays: 2,
    minPostScorePercent: null
  },

  registrationFields: [
    { key: 'department',  label: 'Department',        type: 'text',   required: true },
    { key: 'career_stage', label: 'Career stage',     type: 'select', required: true,
      options: ['Undergraduate', 'Postgraduate', 'Postdoc', 'Staff', 'Other'] },
    { key: 'has_dmp',     label: 'Have you written a data management plan before?',
      type: 'select', required: false, options: ['Yes', 'No', 'Not sure'] }
  ],

  showImmediateResults: true,
  showPerItemReview: true,
  showPreTestScore: false,

  questionsFile: 'content/questions.csv',
  feedbackFile:  'content/feedback.csv',

  backend: 'auto'
};

if (typeof module !== 'undefined' && module.exports) module.exports = COURSE_CONFIG;
if (typeof globalThis !== 'undefined') globalThis.COURSE_CONFIG = COURSE_CONFIG;
