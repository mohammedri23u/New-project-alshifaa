#!/usr/bin/env node
/* ============================================================================
 * tools/selftest.js — end-to-end check of the portal's logic.
 *
 *     node tools/selftest.js
 *
 * Drives the REAL modules the browser uses (src/*.js) against an in-memory
 * stand-in for localStorage: registration, attendance, pre-test, post-test,
 * feedback, certificate eligibility and both exports. No dependencies, no
 * network, nothing installed.
 *
 * Run it after editing content/questions.csv, content/feedback.csv or
 * course.config.js to confirm the portal still has a coherent configuration.
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* --- a minimal localStorage ------------------------------------------- */
const memory = new Map();
globalThis.localStorage = {
  getItem: k => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: k => memory.delete(k),
  clear: () => memory.clear()
};

const config = require(path.join(ROOT, 'course.config.js'));
const Items = require(path.join(ROOT, 'src/items.js'));
const Scoring = require(path.join(ROOT, 'src/scoring.js'));
const Exports = require(path.join(ROOT, 'src/exports.js'));
const StoreDemo = require(path.join(ROOT, 'src/store-demo.js'));

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL  ' + label + (detail ? '  → ' + detail : '')); }
}
function section(name) { console.log('\n' + name); }

async function expectThrow(label, fn, code) {
  try { await fn(); check(label, false, 'no error was raised'); }
  catch (e) { check(label, !code || e.code === code, 'got code ' + e.code); }
}

(async function main() {
  console.log('Course Portal self-test');
  console.log('=======================');
  console.log('Course : ' + config.courseName);
  console.log('Days   : ' + config.days.length + '   Timezone: ' + config.timezone);

  /* ---------------------------------------------------------- content -- */
  section('1. Content files');
  const banks = {
    questions: Items.loadBank(fs.readFileSync(path.join(ROOT, config.questionsFile), 'utf8'), config.questionsFile),
    feedback: Items.loadBank(fs.readFileSync(path.join(ROOT, config.feedbackFile), 'utf8'), config.feedbackFile)
  };
  check('questions.csv has no errors', banks.questions.errors.length === 0, banks.questions.errors.join(' | '));
  check('feedback.csv has no errors', banks.feedback.errors.length === 0, banks.feedback.errors.join(' | '));
  check('there is at least one scored item in both tests', banks.questions.comparableItems().length > 0);
  console.log('        pre items: ' + banks.questions.forPhase('pre').length +
              ', post items: ' + banks.questions.forPhase('post').length +
              ', common scored: ' + banks.questions.comparableItems().length +
              ', feedback items: ' + banks.feedback.forPhase('feedback').length);

  /* ----------------------------------------------------------- config -- */
  section('2. Configuration');
  check('days is between 1 and 5', config.days.length >= 1 && config.days.length <= 5);
  check('every day has an attendance window',
    config.days.every(d => config.windows['attendance_' + d.index]));
  check('timezone is a real IANA name', (() => {
    try { new Intl.DateTimeFormat('en', { timeZone: config.timezone }); return true; } catch (e) { return false; }
  })());

  /* ------------------------------------------------------------ store -- */
  const store = StoreDemo.create({ config });
  await store.reset();

  section('3. Registration');
  // Open everything, exactly as an administrator would from the admin console.
  const allKeys = ['registration', 'pre', 'post', 'feedback']
    .concat(config.days.map(d => 'attendance_' + d.index));
  for (const k of allKeys) await store.setOverride(k, true);

  const learner = {
    email: 'test.learner@example.org',
    password: 'correct-horse-7',
    fullName: 'Test Learner',
    demographics: { affiliation: 'Test Clinic', role: 'Trainee', years_exp: '4', gender: 'Prefer not to say', phone: '+10000000' }
  };
  const signup = await store.signUp(learner);
  check('registration succeeded', !!signup.participant);
  const code = signup.participant.participant_code;
  check('a participant code was issued by the store, not the caller',
    /^[A-Z]+-\d{4}$/.test(code), code);
  console.log('        issued code: ' + code);
  await expectThrow('the same email cannot register twice', () => store.signUp(learner), 'EMAIL_IN_USE');

  section('4. Sign in');
  await store.signOut();
  check('signed out', (await store.currentSession()) === null);
  await expectThrow('a wrong password is rejected',
    () => store.signIn({ email: learner.email, password: 'wrong-password-1' }), 'BAD_CREDENTIALS');
  await store.signIn({ email: learner.email, password: learner.password });
  const sess = await store.currentSession();
  check('signed back in with the learner\'s own password', !!sess && sess.participant.participant_code === code);

  section('5. Attendance');
  await store.setOverride('attendance_1', false);
  await expectThrow('a closed day refuses a check-in', () => store.checkIn(1), 'WINDOW_CLOSED');
  await store.setOverride('attendance_1', true);
  await store.checkIn(1);
  await store.checkIn(1);   // must be idempotent
  // Check in for every configured day, whatever the course length, so that this
  // test stays valid for any `days` list and any minAttendanceDays rule.
  for (const d of config.days) await store.checkIn(d.index);
  let rec = await store.myRecords();
  check('one check-in per configured day, no duplicates',
    rec.attendance.length === config.days.length,
    'got ' + rec.attendance.length + ' for ' + config.days.length + ' day(s)');

  section('6. Pre-test');
  const preItems = banks.questions.forPhase('pre');
  // Deliberately answer badly: first scored item wrong, the rest correct.
  const preAnswers = {};
  let firstScored = true;
  preItems.forEach(it => {
    if (it.type === 'text') { preAnswers[it.id] = 'A baseline free-text answer.'; return; }
    if (it.type === 'likert') { preAnswers[it.id] = '3'; return; }
    if (it.scored && firstScored) {
      firstScored = false;
      preAnswers[it.id] = it.options.find(o => o.letter !== it.answerKey).letter;  // wrong on purpose
    } else {
      preAnswers[it.id] = it.answerKey || it.options[0].letter;
    }
  });
  const preScore = Scoring.scoreSubmission(preItems, preAnswers);
  await store.submitTest('pre', preAnswers, preScore, 240);
  check('pre-test stored with a score', preScore.max > 0 && preScore.percent !== null,
    preScore.raw + '/' + preScore.max);
  console.log('        pre score: ' + preScore.raw + '/' + preScore.max + ' = ' + preScore.percent + '%');
  await expectThrow('the pre-test cannot be submitted twice',
    () => store.submitTest('pre', preAnswers, preScore, 10), 'ALREADY_SUBMITTED');

  section('7. Post-test');
  const postItems = banks.questions.forPhase('post');
  const postAnswers = {};
  postItems.forEach(it => {
    if (it.type === 'text') { postAnswers[it.id] = 'A follow-up free-text answer.'; return; }
    if (it.type === 'likert') { postAnswers[it.id] = '4'; return; }
    postAnswers[it.id] = it.answerKey || it.options[0].letter;   // all correct
  });
  const postScore = Scoring.scoreSubmission(postItems, postAnswers);
  await store.submitTest('post', postAnswers, postScore, 180);
  console.log('        post score: ' + postScore.raw + '/' + postScore.max + ' = ' + postScore.percent + '%');
  check('post-test score is higher than the pre-test', postScore.percent > preScore.percent);

  const cmp = Scoring.comparePrePost(banks.questions.comparableItems(), preAnswers, postAnswers);
  check('pre/post comparison uses only the common items',
    cmp.comparableCount === banks.questions.comparableItems().length);
  check('exactly one item moved from wrong to right', cmp.counts.gained === 1,
    JSON.stringify(cmp.counts));
  check('no item moved from right to wrong', cmp.counts.lost === 0);
  console.log('        change: ' + cmp.changePoints + ' points, normalised gain g = ' + cmp.normalisedGain);

  section('8. Feedback');
  const fbItems = banks.feedback.forPhase('feedback');
  const fbAnswers = {};
  fbItems.forEach(it => {
    // A reverse-scored item must be answered 1 to mean the SAME thing as a 5
    // on a normally-worded item: 6 - 1 = 5.
    if (it.type === 'likert') fbAnswers[it.id] = it.reverseScored ? '1' : '5';
    else if (it.type === 'mcq') fbAnswers[it.id] = it.options[0].letter;
    else fbAnswers[it.id] = 'Free-text feedback for ' + it.id + '.';
  });
  await store.submitFeedback(fbAnswers);
  await expectThrow('feedback cannot be submitted twice',
    () => store.submitFeedback(fbAnswers), 'ALREADY_SUBMITTED');
  const likert = Scoring.likertSummary(fbItems, fbAnswers);
  check('reverse-scored items are corrected before averaging', likert.mean === 5,
    'mean = ' + likert.mean + ' (every item was answered in the favourable direction, so the mean must be 5)');
  // And the correction must actually do something: answer everything "5" and
  // the reverse-worded item should now DRAG THE MEAN DOWN.
  const naive = {};
  fbItems.forEach(it => { if (it.type === 'likert') naive[it.id] = '5'; });
  const naiveMean = Scoring.likertSummary(fbItems, naive).mean;
  check('a reverse-worded item answered 5 lowers the corrected mean', naiveMean < 5,
    'mean = ' + naiveMean);

  section('9. Certificate eligibility');
  rec = await store.myRecords();
  const elig = Scoring.certificateEligibility(config.certificate, {
    registered: true, preDone: true, postDone: true, feedbackDone: true,
    attendanceDays: rec.attendance.length,
    postPercent: postScore.percent
  }, config.days.length);
  elig.checks.forEach(c => console.log('        ' + (c.met ? '[x] ' : '[ ] ') + c.label + ' — ' + c.detail));
  check('the learner is eligible after completing everything', elig.eligible === true,
    elig.outstanding.join('; '));

  const notYet = Scoring.certificateEligibility(config.certificate, {
    registered: true, preDone: true, postDone: false, feedbackDone: false,
    attendanceDays: 0, postPercent: null
  }, config.days.length);
  check('a learner who has done less is NOT eligible', notYet.eligible === false);

  /* ---------------------------------------------------------- exports -- */
  section('10. Exports');
  // A second, half-finished learner, so the exports have to cope with gaps.
  await store.signOut();
  await store.signUp({
    email: 'partial.learner@example.org', password: 'another-good-pass-2',
    fullName: 'Partial Learner',
    demographics: { affiliation: 'Other Site', role: 'Student', phone: '+10000001' }
  });
  await store.checkIn(1);   // this one deliberately stops after day 1
  await store.submitTest('pre', preAnswers, preScore, 300);

  const dataset = await store.fullDataset();
  check('two participants in the dataset', dataset.participants.length === 2);

  const research = Exports.buildResearch(dataset, banks, config);
  const ops = Exports.buildOperations(dataset, banks, config);

  check('research export has one row per participant', research.rows.length === 2);
  check('operations export has one row per participant', ops.rows.length === 2);
  check('every research row has a value for every column',
    research.rows.every(r => research.columns.every(c => c in r)));

  const idColumns = ['full_name', 'email', 'reg_phone'];
  const leaked = research.columns.filter(c => idColumns.includes(c));
  check('research export contains NO identifier columns', leaked.length === 0, leaked.join(', '));
  check('the de-identification guard passes', Exports.assertDeidentified(research, config) === true);

  const researchText = Exports.toCSV(research);
  check('no participant name appears anywhere in the research file',
    !researchText.includes('Test Learner') && !researchText.includes('Partial Learner'));
  check('no email address appears anywhere in the research file',
    !researchText.includes('@example.org'));
  check('no phone number appears anywhere in the research file',
    !researchText.includes('+10000000'));

  check('operations export DOES carry the identifiers it is meant to',
    ops.columns.includes('full_name') && ops.columns.includes('email') && ops.columns.includes('reg_phone'));
  check('operations export carries no item-level answers',
    !ops.columns.some(c => /^(pre|post|fb)_[A-Z]/.test(c)));
  const shared = research.columns.filter(c => ops.columns.includes(c));
  check('participant_code is the linking column between the two exports',
    shared.includes('participant_code'));
  check('the columns the two exports share include no identifier',
    shared.every(c => !idColumns.includes(c)), shared.filter(c => idColumns.includes(c)).join(', '));
  console.log('        shared columns: ' + shared.join(', '));

  const r1 = research.rows.find(r => r.participant_code === code);
  check('the completed learner is flagged matched_pre_post', r1.matched_pre_post === 1);
  check('the completed learner is flagged eligible', r1.certificate_eligible === 1);
  check('change in percentage points is recorded', r1.cmp_change_points === cmp.changePoints);
  const r2 = research.rows.find(r => r.participant_code !== code);
  check('the half-finished learner is NOT matched', r2.matched_pre_post === 0);
  check('the half-finished learner is NOT eligible', r2.certificate_eligible === 0);
  check('the half-finished learner has an outstanding list', String(r2.certificate_outstanding).length > 0);
  console.log('        outstanding for ' + r2.participant_code + ': ' + r2.certificate_outstanding);

  check('every research column is documented', research.dictionary.length === research.columns.length);
  check('every operations column is documented', ops.dictionary.length === ops.columns.length);
  check('no research column name is duplicated',
    new Set(research.columns).size === research.columns.length);

  // Round-trip the CSV to be certain it is well formed.
  const CSV = require(path.join(ROOT, 'src/csv.js'));
  const reparsed = CSV.parseObjects(researchText);
  check('the research CSV re-parses to the same shape',
    reparsed.length === research.rows.length &&
    Object.keys(reparsed[0]).length === research.columns.length,
    reparsed.length + ' rows, ' + Object.keys(reparsed[0] || {}).length + ' columns');

  console.log('        research export : ' + research.rows.length + ' rows × ' + research.columns.length + ' columns');
  console.log('        operations export: ' + ops.rows.length + ' rows × ' + ops.columns.length + ' columns');

  /* --- optionally write the files out for inspection -------------------- */
  if (process.argv.includes('--write')) {
    const outDir = path.join(ROOT, 'exports');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'selftest_research.csv'), researchText);
    fs.writeFileSync(path.join(outDir, 'selftest_research_dictionary.csv'), Exports.dictionaryToCSV(research));
    fs.writeFileSync(path.join(outDir, 'selftest_operations.csv'), Exports.toCSV(ops));
    fs.writeFileSync(path.join(outDir, 'selftest_operations_dictionary.csv'), Exports.dictionaryToCSV(ops));
    console.log('\n        wrote 4 files to exports/');
  }

  /* ------------------------------------------------------------ result -- */
  console.log('\n=======================');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\nFailed checks:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nSELF-TEST CRASHED:', e && e.stack ? e.stack : e);
  process.exit(2);
});
