/* ============================================================================
 * src/exports.js — the two exports.
 *
 *   RESEARCH export    participant_code + every response, flag and timestamp.
 *                      NO names, NO email addresses, NO phone numbers, and no
 *                      field the configuration marks as an identifier.
 *
 *   OPERATIONS export  names and contact details, plus who has completed what.
 *                      Deliberately contains NO item-level answers: staff who
 *                      need to chase up a missing form never need to see how
 *                      an individual answered a question.
 *
 * Both are WIDE: exactly one row per participant, ready to open in R, Stata,
 * SPSS, Python or a spreadsheet with no reshaping. Column order is fixed and
 * deterministic. Every column is described in the generated data dictionary.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function req(name, path) {
    return (global.CP && global.CP[name]) ||
           (typeof require === 'function' ? require(path) : null);
  }
  var Scoring = req('Scoring', './scoring.js');
  var CSV = req('CSV', './csv.js');

  function iso(v) {
    if (!v) return '';
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  function bool01(v) { return v ? 1 : 0; }

  /** Group an array of records by participant_code. */
  function groupBy(rows, key) {
    var m = Object.create(null);
    (rows || []).forEach(function (r) {
      var k = r[key];
      if (!m[k]) m[k] = [];
      m[k].push(r);
    });
    return m;
  }

  /**
   * Assemble everything known about each participant into one object.
   * Shared by both exports and by the admin progress table, so the admin
   * console and the exports can never disagree.
   */
  function assemble(dataset, banks, config) {
    var days = config.days || [];
    var qBank = banks.questions, fBank = banks.feedback;

    var attByP = groupBy(dataset.attendance, 'participant_code');
    var subByP = groupBy(dataset.submissions, 'participant_code');
    var ansByP = groupBy(dataset.answers, 'participant_code');
    var fbByP = groupBy(dataset.feedback, 'participant_code');
    var fbAnsByP = groupBy(dataset.feedbackAnswers, 'participant_code');

    return (dataset.participants || []).slice().sort(function (a, b) {
      return String(a.participant_code).localeCompare(String(b.participant_code), 'en', { numeric: true });
    }).map(function (p) {
      var code = p.participant_code;

      // --- attendance ---------------------------------------------------
      var att = Object.create(null);
      (attByP[code] || []).forEach(function (r) { att[Number(r.day_index)] = r; });
      var attendanceDays = days.filter(function (d) { return att[d.index]; }).length;

      // --- test submissions ---------------------------------------------
      var subs = Object.create(null);
      (subByP[code] || []).forEach(function (s) { subs[s.phase] = s; });

      // --- item answers, split by phase ---------------------------------
      var answers = { pre: Object.create(null), post: Object.create(null) };
      (ansByP[code] || []).forEach(function (a) {
        if (answers[a.phase]) answers[a.phase][a.item_id] = a.response;
      });

      // --- feedback ------------------------------------------------------
      var fbSub = (fbByP[code] || [])[0] || null;
      var fbAnswers = Object.create(null);
      (fbAnsByP[code] || []).forEach(function (a) { fbAnswers[a.item_id] = a.response; });

      var comparison = Scoring.comparePrePost(qBank.comparableItems(), answers.pre, answers.post);
      var likert = Scoring.likertSummary(fBank.items, fbAnswers);

      var state = {
        registered: true,
        preDone: !!subs.pre,
        postDone: !!subs.post,
        feedbackDone: !!fbSub,
        attendanceDays: attendanceDays,
        postPercent: subs.post ? Number(subs.post.score_percent) : null
      };
      var elig = Scoring.certificateEligibility(config.certificate || {}, state, days.length);

      return {
        participant: p, code: code, att: att, attendanceDays: attendanceDays,
        subs: subs, answers: answers, fbSub: fbSub, fbAnswers: fbAnswers,
        comparison: comparison, likert: likert, state: state, eligibility: elig
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* RESEARCH EXPORT                                                        */
  /* ---------------------------------------------------------------------- */
  function buildResearch(dataset, banks, config) {
    var days = config.days || [];
    var qBank = banks.questions, fBank = banks.feedback;
    var preItems = qBank.forPhase('pre'), postItems = qBank.forPhase('post');
    var fbItems = fBank.forPhase('feedback');
    var safeFields = (config.registrationFields || []).filter(function (f) { return f.identifier !== true; });

    var columns = [], dict = [];
    function col(name, type, description) {
      columns.push(name);
      dict.push({ column: name, type: type, description: description });
    }

    col('participant_code', 'string', 'Server-generated immutable code. The linkage key: every row of every instrument for one learner carries this value. Never chosen or typed by the learner.');
    col('registered_at', 'datetime (ISO 8601, UTC)', 'When the learner completed registration.');

    safeFields.forEach(function (f) {
      col('reg_' + f.key, f.type === 'number' ? 'number' : 'string',
          'Registration field: ' + f.label + (f.options ? ' (one of: ' + f.options.join('; ') + ')' : ''));
    });

    days.forEach(function (d) {
      col('att_day' + d.index, '0/1', 'Checked in on day ' + d.index + ' (' + d.title + '). 1 = present.');
    });
    days.forEach(function (d) {
      col('att_day' + d.index + '_at', 'datetime (ISO 8601, UTC)', 'Check-in timestamp for day ' + d.index + '. Empty if absent.');
    });
    col('attendance_days', 'integer', 'Number of days checked in, out of ' + days.length + '.');

    ['pre', 'post'].forEach(function (ph) {
      var L = ph === 'pre' ? 'Pre-test' : 'Post-test';
      col(ph + '_submitted', '0/1', L + ' submitted.');
      col(ph + '_submitted_at', 'datetime (ISO 8601, UTC)', 'When the ' + L.toLowerCase() + ' was submitted.');
      col(ph + '_score_raw', 'number', L + ' points scored (all scored items in that test).');
      col(ph + '_score_max', 'number', L + ' points available.');
      col(ph + '_score_percent', 'number (0-100)', L + ' score as a percentage.');
      col(ph + '_duration_seconds', 'integer', 'Seconds between opening and submitting the ' + L.toLowerCase() + '. Empty if not recorded.');
    });

    col('matched_pre_post', '0/1', 'Learner submitted BOTH tests, so this row can be used in a paired pre/post analysis.');
    col('cmp_n_items', 'integer', 'Number of scored items present in both tests — the basis of the columns below.');
    col('cmp_pre_percent', 'number (0-100)', 'Pre-test score on the common items only.');
    col('cmp_post_percent', 'number (0-100)', 'Post-test score on the common items only.');
    col('cmp_change_points', 'number', 'cmp_post_percent minus cmp_pre_percent, in percentage points.');
    col('cmp_normalised_gain', 'number', "Hake's normalised gain: (post-pre)/(100-pre). Empty when the pre-test was already 100%.");
    col('cmp_items_gained', 'integer', 'Common items wrong before and right after.');
    col('cmp_items_lost', 'integer', 'Common items right before and wrong after.');
    col('cmp_items_kept', 'integer', 'Common items right both times.');
    col('cmp_items_unchanged', 'integer', 'Common items wrong both times.');

    preItems.forEach(function (it) {
      col('pre_' + it.id, it.type === 'mcq' ? 'string (option letter)' : 'string',
          'Pre-test response to ' + it.id + ': ' + it.stem);
      if (it.scored) col('pre_' + it.id + '_correct', '0/1', 'Pre-test response to ' + it.id + ' was correct (key: ' + it.answerKey + ').');
    });
    postItems.forEach(function (it) {
      col('post_' + it.id, it.type === 'mcq' ? 'string (option letter)' : 'string',
          'Post-test response to ' + it.id + ': ' + it.stem);
      if (it.scored) col('post_' + it.id + '_correct', '0/1', 'Post-test response to ' + it.id + ' was correct (key: ' + it.answerKey + ').');
    });

    col('feedback_submitted', '0/1', 'Feedback form submitted.');
    col('feedback_submitted_at', 'datetime (ISO 8601, UTC)', 'When feedback was submitted.');
    fbItems.forEach(function (it) {
      if (it.type === 'likert') {
        col('fb_' + it.id, 'integer 1-5', 'Feedback (as answered, 1=strongly disagree, 5=strongly agree): ' + it.stem);
        col('fb_' + it.id + '_scored', 'integer 1-5',
            it.reverseScored
              ? 'Same item after REVERSE scoring (6 minus the raw value), so that 5 always means the favourable direction.'
              : 'Same as fb_' + it.id + ' (this item is not reverse-scored). Provided so all fb_*_scored columns can be averaged directly.');
      } else {
        col('fb_' + it.id, 'string', 'Feedback response: ' + it.stem);
      }
    });
    col('fb_likert_mean', 'number 1-5', 'Mean of all reverse-corrected Likert feedback items answered by this learner.');
    col('fb_likert_n', 'integer', 'How many Likert items that mean is based on.');

    col('certificate_eligible', '0/1', 'Eligibility computed from the configured rule. In a Supabase deployment this value is computed by the server, not the browser.');
    col('certificate_outstanding', 'string', 'Semicolon-separated list of unmet requirements. Empty when eligible.');
    col('completed_all_components', '0/1', 'Registration, pre-test, post-test and feedback all submitted, regardless of attendance.');

    var rows = assemble(dataset, banks, config).map(function (r) {
      var row = Object.create(null);
      row.participant_code = r.code;
      row.registered_at = iso(r.participant.created_at);

      safeFields.forEach(function (f) {
        var d = r.participant.demographics || {};
        row['reg_' + f.key] = d[f.key] === undefined || d[f.key] === null ? '' : d[f.key];
      });

      days.forEach(function (d) { row['att_day' + d.index] = bool01(r.att[d.index]); });
      days.forEach(function (d) { row['att_day' + d.index + '_at'] = r.att[d.index] ? iso(r.att[d.index].checked_in_at) : ''; });
      row.attendance_days = r.attendanceDays;

      ['pre', 'post'].forEach(function (ph) {
        var s = r.subs[ph];
        row[ph + '_submitted'] = bool01(s);
        row[ph + '_submitted_at'] = s ? iso(s.submitted_at) : '';
        row[ph + '_score_raw'] = s ? s.score_raw : '';
        row[ph + '_score_max'] = s ? s.score_max : '';
        row[ph + '_score_percent'] = s ? s.score_percent : '';
        row[ph + '_duration_seconds'] = s && s.duration_seconds != null ? s.duration_seconds : '';
      });

      var matched = !!(r.subs.pre && r.subs.post);
      var c = r.comparison;
      row.matched_pre_post = bool01(matched);
      row.cmp_n_items = c.comparableCount;
      row.cmp_pre_percent = matched ? c.pre.percent : '';
      row.cmp_post_percent = matched ? c.post.percent : '';
      row.cmp_change_points = matched ? c.changePoints : '';
      row.cmp_normalised_gain = matched && c.normalisedGain !== null ? c.normalisedGain : '';
      row.cmp_items_gained = matched ? c.counts.gained : '';
      row.cmp_items_lost = matched ? c.counts.lost : '';
      row.cmp_items_kept = matched ? c.counts.kept : '';
      row.cmp_items_unchanged = matched ? c.counts.unchanged : '';

      [['pre', preItems], ['post', postItems]].forEach(function (pair) {
        var ph = pair[0], list = pair[1], submitted = !!r.subs[ph];
        list.forEach(function (it) {
          var resp = r.answers[ph][it.id];
          var has = resp !== undefined && resp !== null && String(resp) !== '';
          row[ph + '_' + it.id] = has
            ? (it.type === 'mcq' ? (Scoring.responseLetter(it, resp) || String(resp)) : String(resp))
            : '';
          if (it.scored) {
            row[ph + '_' + it.id + '_correct'] = submitted
              ? bool01(has && Scoring.responseLetter(it, resp) === it.answerKey) : '';
          }
        });
      });

      row.feedback_submitted = bool01(r.fbSub);
      row.feedback_submitted_at = r.fbSub ? iso(r.fbSub.submitted_at) : '';
      fbItems.forEach(function (it) {
        var v = r.fbAnswers[it.id];
        var has = v !== undefined && v !== null && String(v) !== '';
        row['fb_' + it.id] = has ? v : '';
        if (it.type === 'likert') {
          var n = Number(v);
          row['fb_' + it.id + '_scored'] = (has && n >= 1 && n <= 5)
            ? (it.reverseScored ? 6 - n : n) : '';
        }
      });
      row.fb_likert_mean = r.likert.mean === null ? '' : r.likert.mean;
      row.fb_likert_n = r.likert.n;

      row.certificate_eligible = bool01(r.eligibility.eligible);
      row.certificate_outstanding = r.eligibility.outstanding.join('; ');
      row.completed_all_components = bool01(r.state.preDone && r.state.postDone && r.state.feedbackDone);

      return row;
    });

    return { name: 'research', columns: columns, rows: rows, dictionary: dict };
  }

  /* ---------------------------------------------------------------------- */
  /* OPERATIONS EXPORT                                                      */
  /* ---------------------------------------------------------------------- */
  function buildOperations(dataset, banks, config) {
    var days = config.days || [];
    var idFields = (config.registrationFields || []).filter(function (f) { return f.identifier === true; });
    var otherFields = (config.registrationFields || []).filter(function (f) { return f.identifier !== true; });

    var columns = [], dict = [];
    function col(name, type, description) {
      columns.push(name);
      dict.push({ column: name, type: type, description: description });
    }

    col('participant_code', 'string', 'The same code used in the research export, and the only LINKING column between the two files. It lets an administrator act on a research finding without the research file ever holding a name. (The two files also share some non-identifying summary columns such as attendance counts; they share no direct identifier.)');
    col('full_name', 'string', 'DIRECT IDENTIFIER. Name as entered at registration.');
    col('email', 'string', 'DIRECT IDENTIFIER. Login address; also where the learner would be contacted.');
    idFields.forEach(function (f) {
      col('reg_' + f.key, 'string', 'DIRECT IDENTIFIER. Registration field: ' + f.label);
    });
    otherFields.forEach(function (f) {
      col('reg_' + f.key, f.type === 'number' ? 'number' : 'string', 'Registration field: ' + f.label);
    });
    col('registered_at', 'datetime (ISO 8601, UTC)', 'When the learner registered.');

    days.forEach(function (d) {
      col('att_day' + d.index, '0/1', 'Checked in on day ' + d.index + ' (' + d.title + ').');
    });
    col('attendance_days', 'integer', 'Days checked in, out of ' + days.length + '.');
    col('pre_done', '0/1', 'Pre-test submitted.');
    col('post_done', '0/1', 'Post-test submitted.');
    col('feedback_done', '0/1', 'Feedback submitted.');
    col('post_score_percent', 'number (0-100)', 'Post-test percentage — included because some certificate rules depend on it.');
    col('certificate_eligible', '0/1', 'Meets the configured certificate rule.');
    col('certificate_outstanding', 'string', 'What is still missing, semicolon-separated. This is the column to use when chasing people up.');

    var rows = assemble(dataset, banks, config).map(function (r) {
      var row = Object.create(null);
      var d = r.participant.demographics || {};
      row.participant_code = r.code;
      row.full_name = r.participant.full_name || '';
      row.email = r.participant.email || '';
      idFields.concat(otherFields).forEach(function (f) {
        row['reg_' + f.key] = d[f.key] === undefined || d[f.key] === null ? '' : d[f.key];
      });
      row.registered_at = iso(r.participant.created_at);
      days.forEach(function (dd) { row['att_day' + dd.index] = bool01(r.att[dd.index]); });
      row.attendance_days = r.attendanceDays;
      row.pre_done = bool01(r.state.preDone);
      row.post_done = bool01(r.state.postDone);
      row.feedback_done = bool01(r.state.feedbackDone);
      row.post_score_percent = r.subs.post ? r.subs.post.score_percent : '';
      row.certificate_eligible = bool01(r.eligibility.eligible);
      row.certificate_outstanding = r.eligibility.outstanding.join('; ');
      return row;
    });

    return { name: 'operations', columns: columns, rows: rows, dictionary: dict };
  }

  /** Render an export to CSV text. */
  function toCSV(exp) { return CSV.toCSV(exp.rows, exp.columns); }

  /** Render an export's data dictionary to CSV text. */
  function dictionaryToCSV(exp) {
    return CSV.toCSV(exp.dictionary, ['column', 'type', 'description']);
  }

  /**
   * Safety net: assert that no research column can carry a direct identifier.
   * Run before every research download. If this ever throws, the download is
   * refused rather than silently leaking a name.
   */
  function assertDeidentified(exp, config) {
    var banned = ['full_name', 'name', 'email', 'e_mail'];
    (config.registrationFields || []).forEach(function (f) {
      if (f.identifier === true) banned.push('reg_' + f.key);
    });
    var found = exp.columns.filter(function (c) {
      return banned.indexOf(String(c).toLowerCase()) !== -1;
    });
    if (found.length) {
      throw new Error('Refusing to export: the research file would contain identifier column(s): ' + found.join(', '));
    }
    return true;
  }

  var Exports = {
    assemble: assemble,
    buildResearch: buildResearch,
    buildOperations: buildOperations,
    toCSV: toCSV,
    dictionaryToCSV: dictionaryToCSV,
    assertDeidentified: assertDeidentified
  };

  global.CP = global.CP || {};
  global.CP.Exports = Exports;
  if (typeof module !== 'undefined' && module.exports) module.exports = Exports;
})(typeof globalThis !== 'undefined' ? globalThis : this);
