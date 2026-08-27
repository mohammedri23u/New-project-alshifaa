/* ============================================================================
 * src/store-supabase.js — the real backend.
 *
 * Talks to Supabase with the ANON key only. Every table is protected by Row
 * Level Security (see supabase/schema.sql): a learner can read and write only
 * their own rows, and only an account listed in the `admins` table can read
 * anyone else's.
 *
 * The browser is never trusted for anything that matters:
 *   - participant codes are issued by a database trigger
 *   - open/closed windows are enforced by database triggers, not just the UI
 *   - certificate eligibility is computed by a database view
 * ==========================================================================*/
(function (global) {
  'use strict';

  function req(name, path) {
    return (global.CP && global.CP[name]) ||
           (typeof require === 'function' ? require(path) : null);
  }
  var TZ = req('TZ', './tz.js');

  /**
   * Turn a failed Supabase call into something a course coordinator can act on.
   * Pure function of the error object, so every branch is unit-testable without
   * a live project — which matters, because these are exactly the failures you
   * only ever meet on the morning of the course.
   *
   * @returns { kind, lines[] }
   */
  function describeConnectionError(error) {
    var msg = String((error && (error.message || error.msg)) || error || '');
    var code = (error && error.code) || '';
    var status = (error && (error.status || error.statusCode)) || 0;

    // A browser reports every DNS failure, offline state, blocked request and
    // CORS rejection as an opaque "Failed to fetch". All four look identical.
    if (/failed to fetch|networkerror|fetch failed|load failed|err_name_not_resolved|enotfound/i.test(msg)) {
      return { kind: 'unreachable', lines: [
        'Could not reach your Supabase project.',
        'Most likely: SUPABASE_URL in config.js is wrong — check it character by character against ' +
        'Project Settings → API Keys → Project URL. A single wrong letter in the project reference gives exactly this error.',
        'Also possible: the project is paused (free projects pause after inactivity — open the Supabase ' +
        'dashboard and resume it), you are offline, or a firewall is blocking supabase.co.',
        'Technical detail: ' + msg
      ] };
    }

    if (status === 401 || /invalid api key|jwt|apikey|no api key/i.test(msg)) {
      return { kind: 'bad_key', lines: [
        'Your Supabase project answered, but rejected the key.',
        'SUPABASE_ANON_KEY in config.js is wrong, truncated, or from a different project. ' +
        'Copy the whole "anon" / "publishable" key again from Project Settings → API Keys.',
        'Do not use the service_role key: it would expose every participant\'s data to every visitor.',
        'Technical detail: ' + msg
      ] };
    }

    // PGRST205: PostgREST could not find the table in its schema cache.
    if (code === 'PGRST205' || status === 404 || /does not exist|could not find the table|schema cache/i.test(msg)) {
      return { kind: 'no_schema', lines: [
        'Your Supabase project answered, but the portal\'s tables are not there.',
        'You have almost certainly not run supabase/schema.sql yet — do SETUP.md Part 2, ' +
        'then run tools/verify-setup.sql to confirm it worked.',
        'If you did run it, check you were in the right project: the URL in config.js must belong to ' +
        'the same project you pasted the SQL into.',
        'Technical detail: ' + msg
      ] };
    }

    if (status === 403 || code === '42501' || /permission denied|row-level security|not authorized/i.test(msg)) {
      return { kind: 'denied', lines: [
        'Your Supabase project refused this request.',
        'The tables exist but their permissions are not as the portal expects. ' +
        'Re-run supabase/schema.sql, then run tools/verify-setup.sql — it will name the exact problem.',
        'Technical detail: ' + msg
      ] };
    }

    return { kind: 'unknown', lines: [
      'The portal could not talk to your Supabase project.',
      'Run tools/verify-setup.sql in the Supabase SQL editor — it checks the database and ' +
      'reports what is missing.',
      'Technical detail: ' + msg + (code ? ' (code ' + code + ')' : '')
    ] };
  }

  var PROBE_TIMEOUT_MS = 15000;

  function timeoutDescriptor(ms) {
    return { kind: 'timeout', lines: [
      'Your Supabase project did not answer within ' + Math.round(ms / 1000) + ' seconds.',
      'The address in config.js is reachable but is not responding as a Supabase project. ' +
      'Check that SUPABASE_URL is the Project URL from Project Settings → API Keys — a plain ' +
      'website address, or a URL with a path on the end, produces exactly this.',
      'If the URL is right, the project may be paused or the Supabase service may be having an ' +
      'outage: check https://status.supabase.com and your project dashboard.'
    ] };
  }

  function create(options) {
    var opts = options || {};
    var config = opts.config;
    var client = opts.client;
    if (!client) throw new Error('The Supabase client library did not load.');

    var cache = { windows: null, settings: null };

    function fail(error, fallbackCode) {
      var e = new Error(error && error.message ? error.message : String(error));
      e.code = (error && error.code) || fallbackCode || 'SUPABASE_ERROR';
      e.original = error;
      throw e;
    }

    /** Windows published to the server; falls back to course.config.js. */
    function loadWindows(force) {
      if (cache.windows && !force) return Promise.resolve(cache.windows);
      return client.from('component_windows').select('key,opens_at,closes_at,override')
        .then(function (res) {
          if (res.error) fail(res.error);
          var m = Object.create(null);
          (res.data || []).forEach(function (r) { m[r.key] = r; });
          cache.windows = m;
          return m;
        });
    }

    /**
     * Effective state of a component.
     * When the schedule has been published, the server's absolute timestamps
     * are used, so the browser cannot disagree with the database. Until then,
     * the configured wall-clock times are converted using the course timezone.
     */
    function stateFor(published, key) {
      var now = Date.now();
      var row = published[key];
      if (row) {
        var override = (row.override === null || row.override === undefined) ? null : row.override;
        var opens = row.opens_at ? Date.parse(row.opens_at) : null;
        var closes = row.closes_at ? Date.parse(row.closes_at) : null;
        if (override === true)  return { state: 'open', opensMs: opens, closesMs: closes, reason: 'opened by administrator' };
        if (override === false) return { state: 'closed', opensMs: opens, closesMs: closes, reason: 'closed by administrator' };
        if (opens === null && closes === null) return { state: 'unconfigured', opensMs: null, closesMs: null, reason: 'no window configured' };
        if (opens !== null && now < opens) return { state: 'before', opensMs: opens, closesMs: closes, reason: 'not open yet' };
        if (closes !== null && now > closes) return { state: 'after', opensMs: opens, closesMs: closes, reason: 'window has closed' };
        return { state: 'open', opensMs: opens, closesMs: closes, reason: 'open' };
      }
      return TZ.windowState((config.windows || {})[key], config.timezone, now, null);
    }

    function myParticipant() {
      return client.from('participants')
        .select('id,participant_code,full_name,email,demographics,created_at')
        .maybeSingle()
        .then(function (res) {
          if (res.error) fail(res.error);
          return res.data || null;
        });
    }

    var api = {
      mode: 'supabase',

      /**
       * One cheap request made before the UI is shown, so that a wrong URL,
       * a wrong key or a database with no schema is reported as itself instead
       * of surfacing later as an inexplicable blank page.
       * Resolves with null on success, or { kind, lines } describing the fault.
       */
      probe: function (timeoutMs) {
        var limit = timeoutMs === undefined ? PROBE_TIMEOUT_MS : timeoutMs;
        var query = client.from('component_windows').select('key').limit(1)
          .then(function (res) {
            return res.error ? describeConnectionError(res.error) : null;
          })
          .catch(function (e) { return describeConnectionError(e); });

        // The Supabase client sets no timeout of its own. A URL that points at
        // a real host which simply never answers can hang for a minute or more,
        // which looks to the deployer like the portal is broken rather than
        // misconfigured. Cap the wait and say so.
        var timer;
        var timeout = new Promise(function (resolve) {
          timer = setTimeout(function () { resolve(timeoutDescriptor(limit)); }, limit);
        });
        return Promise.race([query, timeout]).then(function (r) {
          clearTimeout(timer);
          return r;
        });
      },

      /* ---- authentication ------------------------------------------- */
      signUp: function (input) {
        return client.auth.signUp({
          email: String(input.email || '').trim(),
          password: input.password,
          options: {
            // Read by the database trigger that creates the participant row.
            data: {
              full_name: String(input.fullName || '').trim(),
              demographics: input.demographics || {}
            },
            emailRedirectTo: global.location ? global.location.origin + global.location.pathname : undefined
          }
        }).then(function (res) {
          if (res.error) {
            if (/already registered|already been registered|user already/i.test(res.error.message || '')) {
              var e = new Error('EMAIL_IN_USE'); e.code = 'EMAIL_IN_USE'; throw e;
            }
            fail(res.error, 'SIGNUP_FAILED');
          }
          // With email confirmation ON (the default, and the recommendation),
          // Supabase returns a user with no active session until the link is opened.
          var hasSession = !!(res.data && res.data.session);
          if (!hasSession) return { needsEmailConfirmation: true, participant: null };
          return myParticipant().then(function (p) {
            return { needsEmailConfirmation: false, participant: p };
          });
        });
      },

      signIn: function (input) {
        return client.auth.signInWithPassword({
          email: String(input.email || '').trim(),
          password: input.password
        }).then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            var e;
            if (/email not confirmed|not confirmed/i.test(msg)) {
              e = new Error('EMAIL_NOT_CONFIRMED'); e.code = 'EMAIL_NOT_CONFIRMED'; throw e;
            }
            e = new Error('BAD_CREDENTIALS'); e.code = 'BAD_CREDENTIALS'; throw e;
          }
          return myParticipant().then(function (p) { return { participant: p }; });
        });
      },

      signOut: function () {
        cache.windows = null;
        return client.auth.signOut().then(function () { return true; });
      },

      currentSession: function () {
        return client.auth.getSession().then(function (res) {
          var session = res && res.data ? res.data.session : null;
          if (!session) return null;
          return Promise.all([
            myParticipant(),
            client.rpc('is_admin').then(function (r) { return r.error ? false : !!r.data; })
          ]).then(function (out) {
            if (!out[0]) return null;   // account exists but has no participant row yet
            return { userId: session.user.id, participant: out[0], isAdmin: out[1] };
          });
        });
      },

      /* ---- windows --------------------------------------------------- */
      windowState: function (key) {
        return loadWindows().then(function (w) { return stateFor(w, key); });
      },
      refreshWindows: function () { return loadWindows(true); },
      windowStateFrom: stateFor,

      setOverride: function (key, value) {
        return client.rpc('admin_set_window_override', { p_key: key, p_override: value })
          .then(function (res) {
            if (res.error) fail(res.error);
            return loadWindows(true).then(function (w) { return stateFor(w, key); });
          });
      },

      /** Push course.config.js windows and certificate rule into the database. */
      publishSchedule: function () {
        var payload = {
          timezone: config.timezone,
          code_prefix: config.participantCodePrefix,
          total_days: (config.days || []).length,
          windows: config.windows || {},
          certificate: config.certificate || {}
        };
        return client.rpc('admin_publish_config', { p_config: payload }).then(function (res) {
          if (res.error) fail(res.error);
          cache.windows = null;
          return true;
        });
      },

      /* ---- learner actions ------------------------------------------- */
      checkIn: function (dayIndex) {
        return client.rpc('record_attendance', { p_day_index: Number(dayIndex) })
          .then(function (res) {
            if (res.error) {
              if (/not open|closed/i.test(res.error.message || '')) {
                var e = new Error(res.error.message); e.code = 'WINDOW_CLOSED'; throw e;
              }
              fail(res.error);
            }
            return res.data;
          });
      },

      submitTest: function (phase, answers, score, durationSeconds) {
        var rows = Object.keys(answers).map(function (itemId) {
          var det = (score.detail || []).filter(function (x) { return x.itemId === itemId; })[0];
          return {
            item_id: itemId,
            response: String(answers[itemId]),
            is_correct: det ? det.isCorrect : null
          };
        }).filter(function (r) { return r.response !== ''; });

        return client.rpc('submit_test', {
          p_phase: phase,
          p_score_raw: score.raw,
          p_score_max: score.max,
          p_score_percent: score.percent,
          p_duration_seconds: durationSeconds == null ? null : Number(durationSeconds),
          p_answers: rows
        }).then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            var e;
            if (/already submitted|duplicate key/i.test(msg)) { e = new Error(msg); e.code = 'ALREADY_SUBMITTED'; throw e; }
            if (/not open|closed/i.test(msg)) { e = new Error(msg); e.code = 'WINDOW_CLOSED'; throw e; }
            fail(res.error);
          }
          return true;
        });
      },

      submitFeedback: function (answers) {
        var rows = Object.keys(answers).map(function (itemId) {
          return { item_id: itemId, response: String(answers[itemId]) };
        }).filter(function (r) { return r.response !== ''; });

        return client.rpc('submit_feedback', { p_answers: rows }).then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            var e;
            if (/already submitted|duplicate key/i.test(msg)) { e = new Error(msg); e.code = 'ALREADY_SUBMITTED'; throw e; }
            if (/not open|closed/i.test(msg)) { e = new Error(msg); e.code = 'WINDOW_CLOSED'; throw e; }
            fail(res.error);
          }
          return true;
        });
      },

      /* ---- reads ------------------------------------------------------ */
      myRecords: function () {
        return myParticipant().then(function (p) {
          if (!p) return null;
          var code = p.participant_code;
          function tag(rows) {
            return (rows || []).map(function (r) {
              r.participant_code = code; return r;
            });
          }
          return Promise.all([
            client.from('attendance').select('day_index,checked_in_at'),
            client.from('test_submissions').select('phase,submitted_at,score_raw,score_max,score_percent,duration_seconds'),
            client.from('test_answers').select('phase,item_id,response,is_correct'),
            client.from('feedback_submissions').select('submitted_at'),
            client.from('feedback_answers').select('item_id,response')
          ]).then(function (r) {
            r.forEach(function (x) { if (x.error) fail(x.error); });
            return {
              participant: p,
              attendance: tag(r[0].data),
              submissions: tag(r[1].data),
              answers: tag(r[2].data),
              feedback: tag(r[3].data),
              feedbackAnswers: tag(r[4].data)
            };
          });
        });
      },

      /** Server-computed eligibility. Authoritative; the UI only displays it. */
      myProgress: function () {
        return client.from('v_my_progress').select('*').maybeSingle().then(function (res) {
          if (res.error) return null;   // view is optional; UI falls back to local logic
          return res.data;
        });
      },

      /** Admin-only. RLS returns nothing at all for a non-admin account. */
      fullDataset: function () {
        return Promise.all([
          client.from('v_admin_participants').select('*'),
          client.from('v_admin_attendance').select('*'),
          client.from('v_admin_test_submissions').select('*'),
          client.from('v_admin_test_answers').select('*'),
          client.from('v_admin_feedback').select('*'),
          client.from('v_admin_feedback_answers').select('*')
        ]).then(function (r) {
          r.forEach(function (x) { if (x.error) fail(x.error); });
          return {
            participants: r[0].data || [], attendance: r[1].data || [],
            submissions: r[2].data || [], answers: r[3].data || [],
            feedback: r[4].data || [], feedbackAnswers: r[5].data || []
          };
        });
      }
    };

    return api;
  }

  var StoreSupabase = {
    create: create,
    describeConnectionError: describeConnectionError,
    timeoutDescriptor: timeoutDescriptor,
    PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS
  };
  global.CP = global.CP || {};
  global.CP.StoreSupabase = StoreSupabase;
  if (typeof module !== 'undefined' && module.exports) module.exports = StoreSupabase;
})(typeof globalThis !== 'undefined' ? globalThis : this);
