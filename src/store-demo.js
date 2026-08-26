/* ============================================================================
 * src/store-demo.js — the no-backend demo store.
 *
 * Keeps everything in localStorage so anyone can try the portal end to end
 * without creating a Supabase project. It deliberately ENFORCES the same rules
 * the database enforces — server-issued participant codes, one submission per
 * component, closed windows reject writes — so that what you see in demo mode
 * is what you get in a real deployment.
 *
 * IT IS NOT SECURE AND IT IS NOT PRIVATE. The data sits unencrypted in one
 * browser profile, and any page on the same origin can read it. Never put real
 * participant data in demo mode.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function req(name, path) {
    return (global.CP && global.CP[name]) ||
           (typeof require === 'function' ? require(path) : null);
  }
  var TZ = req('TZ', './tz.js');
  var Scoring = req('Scoring', './scoring.js');

  var STORAGE_KEY = 'course_portal_demo_v1';
  var PBKDF2_ITERATIONS = 120000;

  function nowMs() { return Date.now(); }
  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  }
  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(a);
    else for (var i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  /**
   * Derive a password hash. Uses PBKDF2-SHA256 where WebCrypto is available
   * (every https page and localhost). Demo mode is not a security boundary,
   * but storing plain passwords even locally is a bad habit to ship.
   */
  function hashPassword(password, salt) {
    var subtle = global.crypto && global.crypto.subtle;
    if (!subtle) {
      // Non-secure context. Demo data is local-only; degrade rather than fail.
      var h = 0, s = 'demo:' + salt + ':' + password;
      for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
      return Promise.resolve('weak-' + (h >>> 0).toString(16));
    }
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return subtle.deriveBits({
          name: 'PBKDF2', salt: enc.encode(salt),
          iterations: PBKDF2_ITERATIONS, hash: 'SHA-256'
        }, key, 256);
      })
      .then(toHex);
  }

  function blank() {
    return {
      users: [], participants: [], attendance: [], submissions: [],
      answers: [], feedback: [], feedbackAnswers: [],
      overrides: {}, schedule: {}, seq: 0, sessionUserId: null
    };
  }

  function create(options) {
    var opts = options || {};
    var config = opts.config;
    var storage = opts.storage || global.localStorage;
    if (!storage) throw new Error('Demo mode needs localStorage (or an equivalent passed in).');

    function load() {
      try {
        var raw = storage.getItem(STORAGE_KEY);
        if (!raw) return blank();
        var d = JSON.parse(raw);
        var b = blank();
        Object.keys(b).forEach(function (k) { if (d[k] === undefined) d[k] = b[k]; });
        return d;
      } catch (e) {
        return blank();
      }
    }
    function save(d) { storage.setItem(STORAGE_KEY, JSON.stringify(d)); }

    function nextCode(d) {
      d.seq += 1;
      var prefix = config.participantCodePrefix || 'CP';
      return prefix + '-' + String(d.seq).padStart(4, '0');
    }

    function findUserByEmail(d, email) {
      var e = String(email || '').trim().toLowerCase();
      return d.users.filter(function (u) { return u.email === e; })[0] || null;
    }
    function participantOf(d, userId) {
      return d.participants.filter(function (p) { return p.id === userId; })[0] || null;
    }

    /** Effective open/closed state of a component, using the course timezone. */
    function windowState(key) {
      var d = load();
      var sched = d.schedule[key] || (config.windows || {})[key] || null;
      var override = d.overrides[key];
      if (override === undefined) override = null;
      return TZ.windowState(sched, config.timezone, nowMs(), override);
    }

    function requireOpen(key) {
      var st = windowState(key);
      if (st.state !== 'open') {
        var err = new Error('This part of the portal is not open (' + st.reason + ').');
        err.code = 'WINDOW_CLOSED';
        err.state = st;
        throw err;
      }
    }

    var api = {
      mode: 'demo',

      /* ---- authentication ------------------------------------------- */
      signUp: function (input) {
        return Promise.resolve().then(function () {
          var d = load();
          requireOpen('registration');
          var email = String(input.email || '').trim().toLowerCase();
          if (findUserByEmail(d, email)) {
            var e = new Error('EMAIL_IN_USE'); e.code = 'EMAIL_IN_USE'; throw e;
          }
          var salt = randomHex(16);
          return hashPassword(input.password, salt).then(function (hash) {
            var d2 = load(); // re-read: password hashing is asynchronous
            var userId = uuid();
            d2.users.push({
              id: userId, email: email, salt: salt, passHash: hash,
              // Demo mode has no mailbox to send to, so accounts start
              // confirmed. A Supabase deployment requires a real confirmation.
              confirmed: true, created_at: new Date().toISOString()
            });
            d2.participants.push({
              id: userId,
              participant_code: nextCode(d2),   // issued here, never by the client
              full_name: String(input.fullName || '').trim(),
              email: email,
              demographics: input.demographics || {},
              created_at: new Date().toISOString()
            });
            d2.sessionUserId = userId;
            save(d2);
            return { needsEmailConfirmation: false, participant: participantOf(d2, userId) };
          });
        });
      },

      signIn: function (input) {
        return Promise.resolve().then(function () {
          var d = load();
          var user = findUserByEmail(d, input.email);
          if (!user) { var e = new Error('BAD_CREDENTIALS'); e.code = 'BAD_CREDENTIALS'; throw e; }
          return hashPassword(input.password, user.salt).then(function (hash) {
            if (hash !== user.passHash) {
              var e2 = new Error('BAD_CREDENTIALS'); e2.code = 'BAD_CREDENTIALS'; throw e2;
            }
            var d2 = load();
            d2.sessionUserId = user.id;
            save(d2);
            return { participant: participantOf(d2, user.id) };
          });
        });
      },

      signOut: function () {
        var d = load(); d.sessionUserId = null; save(d);
        return Promise.resolve(true);
      },

      currentSession: function () {
        var d = load();
        if (!d.sessionUserId) return Promise.resolve(null);
        var p = participantOf(d, d.sessionUserId);
        if (!p) return Promise.resolve(null);
        return Promise.resolve({
          userId: d.sessionUserId,
          participant: p,
          // In demo mode the first person to register is the administrator,
          // so the admin console can be explored without a second account.
          isAdmin: d.participants.length > 0 && d.participants[0].id === d.sessionUserId
        });
      },

      /* ---- windows --------------------------------------------------- */
      windowState: function (key) { return Promise.resolve(windowState(key)); },
      windowStateSync: windowState,

      setOverride: function (key, value) {
        var d = load();
        if (value === null) delete d.overrides[key]; else d.overrides[key] = value;
        save(d);
        return Promise.resolve(windowState(key));
      },

      getOverrides: function () { return Promise.resolve(load().overrides); },

      publishSchedule: function () {
        var d = load();
        d.schedule = JSON.parse(JSON.stringify(config.windows || {}));
        save(d);
        return Promise.resolve(true);
      },

      /* ---- learner actions ------------------------------------------- */
      checkIn: function (dayIndex) {
        return Promise.resolve().then(function () {
          var d = load();
          if (!d.sessionUserId) throw new Error('NOT_SIGNED_IN');
          requireOpen('attendance_' + dayIndex);
          var p = participantOf(d, d.sessionUserId);
          var exists = d.attendance.filter(function (a) {
            return a.participant_code === p.participant_code && Number(a.day_index) === Number(dayIndex);
          })[0];
          if (exists) return exists;                       // idempotent, like the DB
          var rec = {
            participant_code: p.participant_code,
            day_index: Number(dayIndex),
            checked_in_at: new Date().toISOString()
          };
          d.attendance.push(rec); save(d);
          return rec;
        });
      },

      submitTest: function (phase, answers, score, durationSeconds) {
        return Promise.resolve().then(function () {
          var d = load();
          if (!d.sessionUserId) throw new Error('NOT_SIGNED_IN');
          requireOpen(phase);
          var p = participantOf(d, d.sessionUserId);
          var already = d.submissions.filter(function (s) {
            return s.participant_code === p.participant_code && s.phase === phase;
          })[0];
          if (already) { var e = new Error('ALREADY_SUBMITTED'); e.code = 'ALREADY_SUBMITTED'; throw e; }

          d.submissions.push({
            participant_code: p.participant_code, phase: phase,
            submitted_at: new Date().toISOString(),
            score_raw: score.raw, score_max: score.max, score_percent: score.percent,
            duration_seconds: durationSeconds == null ? null : Number(durationSeconds)
          });
          Object.keys(answers).forEach(function (itemId) {
            var v = answers[itemId];
            if (v === undefined || v === null || String(v) === '') return;
            var det = score.detail.filter(function (x) { return x.itemId === itemId; })[0];
            d.answers.push({
              participant_code: p.participant_code, phase: phase, item_id: itemId,
              response: String(v), is_correct: det ? det.isCorrect : null
            });
          });
          save(d);
          return true;
        });
      },

      submitFeedback: function (answers) {
        return Promise.resolve().then(function () {
          var d = load();
          if (!d.sessionUserId) throw new Error('NOT_SIGNED_IN');
          requireOpen('feedback');
          var p = participantOf(d, d.sessionUserId);
          var already = d.feedback.filter(function (f) { return f.participant_code === p.participant_code; })[0];
          if (already) { var e = new Error('ALREADY_SUBMITTED'); e.code = 'ALREADY_SUBMITTED'; throw e; }
          d.feedback.push({ participant_code: p.participant_code, submitted_at: new Date().toISOString() });
          Object.keys(answers).forEach(function (itemId) {
            var v = answers[itemId];
            if (v === undefined || v === null || String(v) === '') return;
            d.feedbackAnswers.push({
              participant_code: p.participant_code, item_id: itemId, response: String(v)
            });
          });
          save(d);
          return true;
        });
      },

      /* ---- reads ------------------------------------------------------ */
      myRecords: function () {
        var d = load();
        if (!d.sessionUserId) return Promise.resolve(null);
        var p = participantOf(d, d.sessionUserId);
        if (!p) return Promise.resolve(null);
        var mine = function (rows) {
          return rows.filter(function (r) { return r.participant_code === p.participant_code; });
        };
        return Promise.resolve({
          participant: p,
          attendance: mine(d.attendance),
          submissions: mine(d.submissions),
          answers: mine(d.answers),
          feedback: mine(d.feedback),
          feedbackAnswers: mine(d.feedbackAnswers)
        });
      },

      /** Admin-only in a real deployment; demo mode has no privilege boundary. */
      fullDataset: function () {
        var d = load();
        return Promise.resolve({
          participants: d.participants, attendance: d.attendance,
          submissions: d.submissions, answers: d.answers,
          feedback: d.feedback, feedbackAnswers: d.feedbackAnswers
        });
      },

      reset: function () { storage.removeItem(STORAGE_KEY); return Promise.resolve(true); }
    };

    return api;
  }

  var StoreDemo = { create: create, STORAGE_KEY: STORAGE_KEY };
  global.CP = global.CP || {};
  global.CP.StoreDemo = StoreDemo;
  if (typeof module !== 'undefined' && module.exports) module.exports = StoreDemo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
