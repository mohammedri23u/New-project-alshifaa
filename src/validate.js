/* ============================================================================
 * src/validate.js — everything that can go wrong in a deployment's own files,
 * detected before the portal shows anyone a screen.
 *
 * This module is deliberately free of DOM and network calls so that
 * tools/selftest.js can exercise every branch without a browser. Each function
 * returns an ARRAY OF STRINGS: one plain-English sentence per problem, naming
 * the file and the setting to change. Nothing throws.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var TZ = (global.CP && global.CP.TZ) ||
           (typeof require === 'function' ? require('./tz.js') : null);

  var COMPONENTS = ['registration', 'pre', 'post', 'feedback'];

  /* --------------------------------------------------------------------- */
  /* course.config.js                                                      */
  /* --------------------------------------------------------------------- */
  function validateConfig(c) {
    var errs = [];
    if (!c) return ['course.config.js did not load at all. Check that the file exists and has no syntax error.'];

    /* ---- days ---- */
    var days = c.days;
    if (!Array.isArray(days)) {
      errs.push('course.config.js: `days` must be a list, e.g. days: [ { index: 1, title: "Day 1" } ].');
      days = [];
    } else if (days.length < 1 || days.length > 5) {
      errs.push('course.config.js: `days` must contain between 1 and 5 entries (found ' + days.length + ').');
    }

    var seenIndex = Object.create(null);
    days.forEach(function (d, i) {
      var label = 'days[' + i + ']';
      if (!d || typeof d !== 'object') { errs.push('course.config.js: ' + label + ' is not an object.'); return; }
      if (Number(d.index) !== i + 1) {
        errs.push('course.config.js: ' + label + '.index is ' + JSON.stringify(d.index) +
                  ' but should be ' + (i + 1) + '. Days must be numbered 1, 2, 3, … in order.');
      }
      if (seenIndex[d.index]) {
        errs.push('course.config.js: two days both have index ' + d.index + '. Each day needs its own number.');
      }
      seenIndex[d.index] = true;
      if (!d.title || !String(d.title).trim()) {
        errs.push('course.config.js: ' + label + ' (day ' + d.index + ') has no `title`. ' +
                  'Every day needs a title — it is shown on the check-in card and in the exports.');
      }
    });

    /* ---- timezone ---- */
    if (!c.timezone) {
      errs.push('course.config.js: `timezone` is missing. Set it to an IANA name such as "Africa/Cairo".');
      return errs;
    }
    try {
      TZ.offsetMs(Date.now(), c.timezone);
    } catch (e) {
      // Every window check below converts times using this timezone, so there
      // is nothing more to say until it is fixed.
      errs.push('course.config.js: timezone "' + c.timezone + '" is not a valid IANA timezone name. ' +
                'Use a name from the tz database, such as "Africa/Cairo" or "Europe/London". ' +
                'A fixed offset like "+03" will not work.');
      return errs;
    }

    /* ---- windows ---- */
    var windows = c.windows || {};
    if (!c.windows) errs.push('course.config.js: `windows` is missing entirely. Nothing will ever be open.');

    var expectedKeys = COMPONENTS.concat(days.map(function (d) { return 'attendance_' + d.index; }));

    days.forEach(function (d) {
      if (!windows['attendance_' + d.index]) {
        errs.push('course.config.js: there is no windows.attendance_' + d.index + ' entry for day ' +
                  d.index + ' ("' + (d.title || '') + '"). Add one, or remove that day.');
      }
    });

    Object.keys(windows).forEach(function (k) {
      if (expectedKeys.indexOf(k) === -1) {
        var m = /^attendance_(\d+)$/.exec(k);
        if (m) {
          errs.push('course.config.js: windows.' + k + ' refers to day ' + m[1] +
                    ', but `days` only has ' + days.length + ' entr' + (days.length === 1 ? 'y' : 'ies') +
                    '. Add the day, or delete this window.');
        } else {
          errs.push('course.config.js: windows.' + k + ' is not a component this portal knows about. ' +
                    'Expected one of: ' + expectedKeys.join(', ') + '.');
        }
        return;
      }
      var w = windows[k];
      if (!w || typeof w !== 'object') {
        errs.push('course.config.js: windows.' + k + ' should be an object with opensAt and closesAt.');
        return;
      }
      ['opensAt', 'closesAt'].forEach(function (f) {
        if (w[f] && isNaN(TZ.wallToInstant(w[f], c.timezone))) {
          errs.push('course.config.js: windows.' + k + '.' + f + ' ("' + w[f] + '") is not in ' +
                    'YYYY-MM-DDTHH:mm form, e.g. "2026-09-07T09:30". Do not add a "Z" or a "+03:00".');
        }
      });
      if (w.opensAt && w.closesAt &&
          !isNaN(TZ.wallToInstant(w.opensAt, c.timezone)) &&
          !isNaN(TZ.wallToInstant(w.closesAt, c.timezone)) &&
          TZ.wallToInstant(w.opensAt, c.timezone) > TZ.wallToInstant(w.closesAt, c.timezone)) {
        errs.push('course.config.js: windows.' + k + ' closes (' + w.closesAt + ') before it opens (' +
                  w.opensAt + '), so it would never be open.');
      }
    });

    /* ---- certificate rule ---- */
    var cert = c.certificate;
    if (!cert) {
      errs.push('course.config.js: `certificate` is missing. Add a rule, even an empty one.');
    } else {
      var required = cert.requiredComponents;
      if (required !== undefined && !Array.isArray(required)) {
        errs.push('course.config.js: certificate.requiredComponents must be a list.');
      } else {
        (required || []).forEach(function (r) {
          if (COMPONENTS.indexOf(r) === -1) {
            errs.push('course.config.js: certificate.requiredComponents contains "' + r +
                      '", which is not a component. Use only: ' + COMPONENTS.join(', ') + '.');
            return;
          }
          // Requiring something that can never open is the subtle one: the rule
          // looks right, and nobody can ever qualify.
          if (r !== 'registration' && !windows[r]) {
            errs.push('course.config.js: the certificate requires "' + r + '", but windows.' + r +
                      ' is not configured, so ' + r + ' never opens and nobody can ever qualify. ' +
                      'Either add windows.' + r + ' or remove "' + r + '" from certificate.requiredComponents.');
          }
        });
      }

      var minDays = cert.minAttendanceDays;
      if (minDays !== undefined && minDays !== null) {
        if (typeof minDays !== 'number' || isNaN(minDays) || minDays < 0) {
          errs.push('course.config.js: certificate.minAttendanceDays must be a number of 0 or more.');
        } else if (minDays > days.length) {
          errs.push('course.config.js: certificate.minAttendanceDays is ' + minDays +
                    ' but the course only has ' + days.length + ' day(s), so nobody can ever qualify. ' +
                    'Lower it to ' + days.length + ' or fewer.');
        }
      }

      var minPost = cert.minPostScorePercent;
      if (minPost !== undefined && minPost !== null) {
        if (typeof minPost !== 'number' || isNaN(minPost) || minPost < 0 || minPost > 100) {
          errs.push('course.config.js: certificate.minPostScorePercent must be a number between 0 and 100, ' +
                    'or null for no cut-off.');
        } else if (minPost > 0 && (required || []).indexOf('post') === -1) {
          errs.push('course.config.js: certificate.minPostScorePercent is set to ' + minPost +
                    ', but "post" is not in certificate.requiredComponents, so a learner who never ' +
                    'sits the post-test would still qualify. Add "post" to requiredComponents.');
        }
      }
    }

    /* ---- registration fields ---- */
    var keys = Object.create(null);
    var reserved = ['participant_code', 'full_name', 'email', 'password'];
    (c.registrationFields || []).forEach(function (f, i) {
      if (!f || !f.key) { errs.push('course.config.js: registrationFields[' + i + '] has no `key`.'); return; }
      if (!/^[a-z0-9_]+$/i.test(f.key)) {
        errs.push('course.config.js: registrationFields key "' + f.key + '" may contain only letters, ' +
                  'digits and underscores — it becomes a column name in the exports.');
      }
      if (reserved.indexOf(String(f.key).toLowerCase()) !== -1) {
        errs.push('course.config.js: registrationFields key "' + f.key + '" is reserved. ' +
                  'Name, email and password are always collected; do not list them again.');
      }
      if (keys[f.key]) errs.push('course.config.js: registrationFields key "' + f.key + '" is used twice.');
      keys[f.key] = true;
      if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) {
        errs.push('course.config.js: registrationFields "' + f.key + '" is a select but has no options.');
      }
    });

    /* ---- content file paths ---- */
    if (!c.questionsFile) errs.push('course.config.js: `questionsFile` is missing (usually "content/questions.csv").');
    if (!c.feedbackFile)  errs.push('course.config.js: `feedbackFile` is missing (usually "content/feedback.csv").');

    /* ---- language ---- */
    if (c.language && global.CP && global.CP.I18n &&
        global.CP.I18n.available && global.CP.I18n.available.indexOf(c.language) === -1) {
      errs.push('course.config.js: language "' + c.language + '" has no translation; falling back to English. ' +
                'Add it to src/i18n.js or use one of: ' + global.CP.I18n.available.join(', ') + '.');
    }

    return errs;
  }

  /* --------------------------------------------------------------------- */
  /* The configuration and the content files have to agree with each other. */
  /* --------------------------------------------------------------------- */
  function validateContent(c, banks) {
    var errs = [];
    var required = (c.certificate && c.certificate.requiredComponents) || [];

    function countFor(phase) { return banks.questions.forPhase(phase).length; }

    ['pre', 'post'].forEach(function (phase) {
      if (countFor(phase) === 0) {
        var msg = c.questionsFile + ' contains no questions for the ' + phase + '-test. ' +
                  'Give at least one item phase: "' + phase + '" or phase: "both".';
        if (required.indexOf(phase) !== -1) {
          errs.push(msg + ' The certificate requires the ' + phase + '-test, so nobody could ever qualify.');
        } else {
          errs.push(msg);
        }
      }
    });

    if (banks.feedback.forPhase('feedback').length === 0) {
      var fmsg = c.feedbackFile + ' contains no feedback questions. ' +
                 'Give at least one item phase: "feedback".';
      errs.push(required.indexOf('feedback') !== -1
        ? fmsg + ' The certificate requires feedback, so nobody could ever qualify.'
        : fmsg);
    }

    if (banks.questions.comparableItems().length === 0 && countFor('pre') > 0 && countFor('post') > 0) {
      errs.push(c.questionsFile + ': no scored question appears in BOTH tests, so there is nothing to ' +
                'compare and the results report would be empty. Mark your scored items phase: "both" ' +
                'and give each of them an answer_key.');
    }

    // Items whose phase means they will never be shown to anyone.
    banks.feedback.items.forEach(function (it) {
      if (it.phase !== 'feedback') {
        errs.push(c.feedbackFile + ': item ' + it.id + ' has phase "' + it.phase + '", but every item in ' +
                  'this file must have phase "feedback". It would never be shown.');
      }
    });
    banks.questions.items.forEach(function (it) {
      if (it.phase === 'feedback') {
        errs.push(c.questionsFile + ': item ' + it.id + ' has phase "feedback", but feedback items belong ' +
                  'in ' + c.feedbackFile + '. It would never be shown.');
      }
    });

    return errs;
  }

  /* --------------------------------------------------------------------- */
  /* config.js — which backend should we use, and is it usable?             */
  /* --------------------------------------------------------------------- */
  var PLACEHOLDER_URL = 'YOUR-PROJECT-REF';
  var PLACEHOLDER_KEY = 'YOUR-ANON';

  /**
   * Decide the backend from config.js and course.config.js.
   * @returns { mode: 'demo'|'supabase', errors: [], notes: [] }
   *          mode is only meaningful when errors is empty.
   */
  function chooseBackend(appConfig, courseConfig) {
    var want = (courseConfig && courseConfig.backend) || 'auto';
    var errors = [], notes = [];

    if (['auto', 'demo', 'supabase'].indexOf(want) === -1) {
      errors.push('course.config.js: backend must be "auto", "demo" or "supabase" (found "' + want + '").');
      return { mode: 'demo', errors: errors, notes: notes };
    }

    if (want === 'demo') return { mode: 'demo', errors: errors, notes: ['backend is set to "demo".'] };

    var present = !!appConfig;
    var url = present ? String(appConfig.SUPABASE_URL || '').trim() : '';
    var key = present ? String(appConfig.SUPABASE_ANON_KEY || '').trim() : '';
    var isPlaceholder = url.indexOf(PLACEHOLDER_URL) !== -1 || key.indexOf(PLACEHOLDER_KEY) !== -1;
    var untouched = !present || (!url && !key) || isPlaceholder;

    if (untouched) {
      if (want === 'supabase') {
        errors.push(present
          ? 'course.config.js sets backend: "supabase", but config.js still contains the placeholder values from config.sample.js. Paste your real Project URL and anon key into config.js (SETUP.md Part 4).'
          : 'course.config.js sets backend: "supabase", but there is no config.js. Copy config.sample.js to config.js and fill it in (SETUP.md Part 4).');
        return { mode: 'demo', errors: errors, notes: notes };
      }
      return { mode: 'demo', errors: errors, notes: [
        present ? 'config.js still has its placeholder values, so the portal is in demo mode.'
                : 'No config.js was found, so the portal is in demo mode.'] };
    }

    // Half-filled config.js is nearly always a copy-paste slip. Say so rather
    // than dropping silently into demo mode, which looks like "nothing happened".
    if (!url || !key) {
      errors.push('config.js is incomplete: ' + (!url ? 'SUPABASE_URL' : 'SUPABASE_ANON_KEY') +
                  ' is empty. Both values are on the Supabase page Project Settings → API Keys (SETUP.md Part 4).');
      return { mode: 'demo', errors: errors, notes: notes };
    }
    if (!/^https:\/\/[^\s/]+/i.test(url)) {
      errors.push('config.js: SUPABASE_URL ("' + url + '") does not look like a URL. ' +
                  'It should be the Project URL, of the form https://abcdefghijkl.supabase.co ' +
                  '— not a database connection string and not a key.');
      return { mode: 'demo', errors: errors, notes: notes };
    }
    if (/\/$/.test(url)) {
      notes.push('config.js: SUPABASE_URL ends with a "/", which is harmless but unusual.');
    }
    // A service_role key is a JWT whose payload contains "service_role". Pasting
    // it here would publish full database access to every visitor.
    if (looksLikeServiceRoleKey(key)) {
      errors.push('config.js: that looks like the SERVICE ROLE key, not the anon key. ' +
                  'The service_role key bypasses every security rule and must never be put in a web page. ' +
                  'Use the key labelled "anon" / "publishable" instead (SETUP.md Part 4).');
      return { mode: 'demo', errors: errors, notes: notes };
    }
    if (key.length < 20) {
      errors.push('config.js: SUPABASE_ANON_KEY looks too short to be a real key (' + key.length + ' characters). ' +
                  'Copy the whole value — it is long.');
      return { mode: 'demo', errors: errors, notes: notes };
    }

    return { mode: 'supabase', errors: errors, notes: notes };
  }

  /** Best-effort detection of a Supabase service_role JWT. */
  function looksLikeServiceRoleKey(key) {
    var parts = String(key).split('.');
    if (parts.length !== 3) return false;
    try {
      var json = decodeBase64Url(parts[1]);
      return /"role"\s*:\s*"service_role"/.test(json);
    } catch (e) {
      return false;
    }
  }

  function decodeBase64Url(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob === 'function') return atob(b64);
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('binary');
    return '';
  }

  var Validate = {
    validateConfig: validateConfig,
    validateContent: validateContent,
    chooseBackend: chooseBackend,
    looksLikeServiceRoleKey: looksLikeServiceRoleKey,
    COMPONENTS: COMPONENTS
  };

  global.CP = global.CP || {};
  global.CP.Validate = Validate;
  if (typeof module !== 'undefined' && module.exports) module.exports = Validate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
