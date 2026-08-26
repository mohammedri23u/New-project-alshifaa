/* ============================================================================
 * src/scoring.js — deterministic scoring, pre/post comparison and certificate
 * eligibility.
 *
 * Every function here is a pure function of its inputs. There is no runtime AI,
 * no network call, no randomness and no clock read except the one explicitly
 * passed in. The same inputs always produce the same outputs, which is what
 * makes the results reproducible from the exported data alone.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /** Normalise a stored response to the letter form used by the answer key. */
  function responseLetter(item, response) {
    if (response === null || response === undefined || response === '') return null;
    var s = String(response).trim();
    var byLetter = item.options.filter(function (o) { return o.letter === s.toUpperCase(); });
    if (byLetter.length === 1) return byLetter[0].letter;
    var byText = item.options.filter(function (o) { return o.text === s; });
    if (byText.length === 1) return byText[0].letter;
    return null;
  }

  /**
   * Score one test submission.
   * @param items    the items shown for this phase
   * @param answers  { item_id: response }
   * @returns { raw, max, percent, answered, scoredCount, detail[] }
   */
  function scoreSubmission(items, answers) {
    var raw = 0, max = 0, answered = 0, scoredCount = 0, detail = [];
    var a = answers || {};

    items.forEach(function (item) {
      var response = a[item.id];
      var hasResponse = response !== null && response !== undefined && String(response).trim() !== '';
      if (hasResponse) answered++;

      var isCorrect = null, points = 0;
      if (item.scored) {
        scoredCount++;
        max += item.points;
        var letter = responseLetter(item, response);
        isCorrect = letter !== null && letter === item.answerKey;
        if (isCorrect) { points = item.points; raw += item.points; }
      }

      detail.push({
        itemId: item.id,
        type: item.type,
        stem: item.stem,
        scored: item.scored,
        response: hasResponse ? String(response) : null,
        responseLetter: item.type === 'mcq' ? responseLetter(item, response) : null,
        responseText: item.type === 'mcq' ? optionText(item, response) : (hasResponse ? String(response) : null),
        answerKey: item.answerKey,
        answerText: item.answerText,
        isCorrect: isCorrect,
        points: points,
        maxPoints: item.scored ? item.points : 0
      });
    });

    return {
      raw: raw,
      max: max,
      percent: max > 0 ? round2(raw / max * 100) : null,
      answered: answered,
      scoredCount: scoredCount,
      detail: detail
    };
  }

  function optionText(item, response) {
    var l = responseLetter(item, response);
    if (!l) return null;
    var o = item.options.filter(function (x) { return x.letter === l; })[0];
    return o ? o.text : null;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * Compare a pre-test and a post-test using only the items that appeared in
   * both and are scored. Comparing whole-test scores would be wrong whenever
   * the two tests do not contain identical scored items.
   */
  function comparePrePost(comparableItems, preAnswers, postAnswers) {
    var pre = scoreSubmission(comparableItems, preAnswers || {});
    var post = scoreSubmission(comparableItems, postAnswers || {});

    var items = comparableItems.map(function (item, i) {
      var p = pre.detail[i], q = post.detail[i];
      var movement = 'unchanged';
      if (p.isCorrect === false && q.isCorrect === true) movement = 'gained';
      else if (p.isCorrect === true && q.isCorrect === false) movement = 'lost';
      else if (p.isCorrect === true && q.isCorrect === true) movement = 'kept';
      return {
        itemId: item.id, stem: item.stem, options: item.options,
        answerKey: item.answerKey, answerText: item.answerText,
        pre: { letter: p.responseLetter, text: p.responseText, isCorrect: p.isCorrect },
        post: { letter: q.responseLetter, text: q.responseText, isCorrect: q.isCorrect },
        movement: movement
      };
    });

    var counts = { gained: 0, lost: 0, kept: 0, unchanged: 0 };
    items.forEach(function (it) { counts[it.movement]++; });

    var changePoints = post.percent !== null && pre.percent !== null
      ? round2(post.percent - pre.percent) : null;

    // Normalised gain (Hake's g): how much of the available improvement was
    // achieved. Undefined when the learner already scored 100% on the pre-test.
    var normalisedGain = null;
    if (pre.percent !== null && post.percent !== null && pre.percent < 100) {
      normalisedGain = round2((post.percent - pre.percent) / (100 - pre.percent));
    }

    return {
      comparableCount: comparableItems.length,
      pre: { raw: pre.raw, max: pre.max, percent: pre.percent },
      post: { raw: post.raw, max: post.max, percent: post.percent },
      changePoints: changePoints,
      normalisedGain: normalisedGain,
      counts: counts,
      items: items
    };
  }

  /**
   * Average a set of Likert responses, applying reverse scoring where the item
   * is flagged. Returns null when nothing was answered.
   */
  function likertSummary(items, answers) {
    var vals = [], a = answers || {};
    items.forEach(function (item) {
      if (item.type !== 'likert') return;
      var v = Number(a[item.id]);
      if (!v || v < 1 || v > 5) return;
      vals.push(item.reverseScored ? (6 - v) : v);
    });
    if (vals.length === 0) return { mean: null, n: 0 };
    var sum = vals.reduce(function (x, y) { return x + y; }, 0);
    return { mean: round2(sum / vals.length), n: vals.length };
  }

  /**
   * Certificate eligibility.
   *
   * This mirrors, line for line, the SQL in supabase/schema.sql
   * (view `v_participant_progress`). In a Supabase deployment the SERVER's
   * answer is authoritative and is the one displayed; this function produces
   * the same answer in demo mode and is used to explain the decision.
   *
   * @param rule     COURSE_CONFIG.certificate
   * @param state    { registered, preDone, postDone, feedbackDone,
   *                   attendanceDays, postPercent }
   * @param totalDays number of days configured
   */
  function certificateEligibility(rule, state, totalDays) {
    var required = rule.requiredComponents || [];
    var checks = [];

    var componentDone = {
      registration: !!state.registered,
      pre: !!state.preDone,
      post: !!state.postDone,
      feedback: !!state.feedbackDone
    };

    required.forEach(function (c) {
      checks.push({
        key: c,
        label: 'Completed ' + c,
        met: componentDone[c] === true,
        detail: componentDone[c] ? 'done' : 'not yet completed'
      });
    });

    var minDays = Math.min(Number(rule.minAttendanceDays || 0), totalDays);
    var days = Number(state.attendanceDays || 0);
    checks.push({
      key: 'attendance',
      label: 'Attended at least ' + minDays + ' of ' + totalDays + ' day(s)',
      met: days >= minDays,
      detail: days + ' of ' + totalDays + ' day(s) recorded'
    });

    if (rule.minPostScorePercent !== null && rule.minPostScorePercent !== undefined) {
      var need = Number(rule.minPostScorePercent);
      var got = state.postPercent;
      checks.push({
        key: 'post_score',
        label: 'Scored at least ' + need + '% on the post-test',
        met: got !== null && got !== undefined && Number(got) >= need,
        detail: (got === null || got === undefined) ? 'no post-test score yet' : got + '%'
      });
    }

    var eligible = checks.every(function (c) { return c.met; });
    return {
      eligible: eligible,
      checks: checks,
      outstanding: checks.filter(function (c) { return !c.met; }).map(function (c) { return c.label; })
    };
  }

  var Scoring = {
    scoreSubmission: scoreSubmission,
    comparePrePost: comparePrePost,
    likertSummary: likertSummary,
    certificateEligibility: certificateEligibility,
    responseLetter: responseLetter,
    round2: round2
  };

  global.CP = global.CP || {};
  global.CP.Scoring = Scoring;
  if (typeof module !== 'undefined' && module.exports) module.exports = Scoring;
})(typeof globalThis !== 'undefined' ? globalThis : this);
