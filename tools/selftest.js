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
const Validate = require(path.join(ROOT, 'src/validate.js'));
const StoreSupabase = require(path.join(ROOT, 'src/store-supabase.js'));
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

  /* ------------------------------------------------- failure handling -- */
  // Every one of these is a mistake a real deployer makes. Each must produce a
  // specific, named error — never a blank screen, never a silent no-op.
  section('11. Misconfiguration is reported clearly');

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function expectError(label, errors, fragment) {
    const hit = errors.some(e => e.toLowerCase().includes(fragment.toLowerCase()));
    check(label, hit, hit ? '' : 'errors were: ' + (errors.join(' | ') || '(none)'));
  }

  check('the shipped configuration itself is valid',
    Validate.validateConfig(config).length === 0, Validate.validateConfig(config).join(' | '));

  // --- course.config.js ---
  let bad = clone(config); bad.timezone = 'Mars/Olympus_Mons';
  expectError('invalid timezone is named', Validate.validateConfig(bad), 'not a valid IANA timezone');

  bad = clone(config); bad.windows.pre.closesAt = 'next tuesday';
  expectError('malformed date is named', Validate.validateConfig(bad), 'YYYY-MM-DDTHH:mm form');

  bad = clone(config); bad.windows.post = { opensAt: '2026-09-30T13:00', closesAt: '2026-09-12T23:59' };
  expectError('a window that closes before it opens', Validate.validateConfig(bad), 'closes');

  bad = clone(config); bad.days = bad.days.slice(0, 2);   // windows.attendance_3 now orphaned
  expectError('an attendance window with no matching day', Validate.validateConfig(bad), 'only has 2 entries');

  bad = clone(config); delete bad.windows['attendance_' + bad.days[bad.days.length - 1].index];
  expectError('a day with no attendance window', Validate.validateConfig(bad), 'no windows.attendance_');

  bad = clone(config); delete bad.days[1].title;
  expectError('a day with no title', Validate.validateConfig(bad), 'has no `title`');

  bad = clone(config); bad.days[1].index = 5;
  expectError('days numbered out of order', Validate.validateConfig(bad), 'should be 2');

  bad = clone(config); bad.days = [];
  expectError('zero days configured', Validate.validateConfig(bad), 'between 1 and 5');

  bad = clone(config); bad.certificate.minAttendanceDays = 9;
  expectError('attendance minimum above the course length', Validate.validateConfig(bad), 'nobody can ever qualify');

  bad = clone(config); bad.certificate.requiredComponents = ['registration', 'posttest'];
  expectError('a typo in requiredComponents', Validate.validateConfig(bad), 'is not a component');

  bad = clone(config); delete bad.windows.post;
  expectError('certificate requires a component that never opens',
    Validate.validateConfig(bad), 'never opens and nobody can ever qualify');

  bad = clone(config); bad.certificate.minPostScorePercent = 150;
  expectError('an out-of-range pass mark', Validate.validateConfig(bad), 'between 0 and 100');

  bad = clone(config);
  bad.certificate.minPostScorePercent = 50;
  bad.certificate.requiredComponents = ['registration', 'pre'];
  expectError('a pass mark that can be dodged by skipping the test',
    Validate.validateConfig(bad), 'would still qualify');

  bad = clone(config); bad.registrationFields.push({ key: 'email', label: 'Email', type: 'text' });
  expectError('a registration field that shadows a built-in', Validate.validateConfig(bad), 'is reserved');

  bad = clone(config); bad.registrationFields.push({ key: 'role', label: 'Role again', type: 'text' });
  expectError('a duplicated registration field', Validate.validateConfig(bad), 'is used twice');

  bad = clone(config); bad.registrationFields.push({ key: 'bad key!', label: 'X', type: 'text' });
  expectError('a registration key that cannot be a column name',
    Validate.validateConfig(bad), 'letters, digits and underscores');

  bad = clone(config); bad.registrationFields.push({ key: 'site', label: 'Site', type: 'select' });
  expectError('a select field with no options', Validate.validateConfig(bad), 'has no options');

  // --- content files ---
  section('12. Broken content files are reported clearly');

  function bankErrors(csv, name) { return Items.loadBank(csv, name || 'questions.csv').errors; }

  expectError('an empty questions file', bankErrors(''), 'is empty');
  expectError('a header row with no questions',
    bankErrors('item_id,type,stem,phase'), 'no questions');
  expectError('a missing required column',
    bankErrors('item_id,type,options\nQ1,mcq,A|B'), 'missing the column(s): stem');
  expectError('a misspelled column',
    bankErrors('item_id,type,stem,phase,anser_key\nQ1,text,Hi,pre,x'), 'unrecognised column "anser_key"');
  expectError('a duplicated item_id',
    bankErrors('item_id,type,stem,options,answer_key,phase\nQ1,mcq,A?,A|B,A,both\nQ1,mcq,B?,A|B,B,both'),
    'used more than once');
  expectError('an answer_key that matches no option',
    bankErrors('item_id,type,stem,options,answer_key,phase\nQ1,mcq,A?,A|B,Z,both'), 'does not match any option');
  expectError('an mcq with no options',
    bankErrors('item_id,type,stem,options,answer_key,phase\nQ1,mcq,A?,,,both'), 'needs options separated by');
  expectError('an unknown item type',
    bankErrors('item_id,type,stem,phase\nQ1,essay,Discuss,pre'), 'must be mcq, likert or text');
  expectError('an unknown phase',
    bankErrors('item_id,type,stem,phase\nQ1,text,Hi,someday'), 'must be pre, post, both or feedback');
  expectError('an item_id that cannot be a column name',
    bankErrors('item_id,type,stem,phase\nQ 1,text,Hi,pre'), 'may contain only letters');

  // --- content vs configuration ---
  section('13. Content and configuration are cross-checked');

  function crossCheck(qCsv, fCsv, cfg) {
    return Validate.validateContent(cfg || config, {
      questions: Items.loadBank(qCsv, 'content/questions.csv'),
      feedback: Items.loadBank(fCsv, 'content/feedback.csv')
    });
  }
  const goodQ = fs.readFileSync(path.join(ROOT, config.questionsFile), 'utf8');
  const goodF = fs.readFileSync(path.join(ROOT, config.feedbackFile), 'utf8');

  check('the shipped content passes the cross-check',
    crossCheck(goodQ, goodF).length === 0, crossCheck(goodQ, goodF).join(' | '));

  expectError('no post-test questions at all',
    crossCheck('item_id,type,stem,options,answer_key,phase\nQ1,mcq,A?,A|B,A,pre', goodF),
    'no questions for the post-test');
  expectError('no feedback questions at all',
    crossCheck(goodQ, 'item_id,type,stem,phase\nF1,text,Hi,pre'),
    'no feedback questions');
  expectError('nothing scored in both tests, so no comparison is possible',
    crossCheck('item_id,type,stem,options,answer_key,phase\nQ1,mcq,A?,A|B,A,pre\nQ2,mcq,B?,A|B,B,post', goodF),
    'no scored question appears in BOTH tests');
  expectError('a feedback item filed in the questions file',
    crossCheck(goodQ + '\nQ99,text,Stray,,,,feedback,0', goodF), 'belong in content/feedback.csv');

  // --- config.js and the backend choice ---
  section('14. config.js problems are reported clearly');

  const REAL_KEY = 'a'.repeat(60);
  function backend(appCfg, cfg) { return Validate.chooseBackend(appCfg, cfg || config); }

  check('no config.js at all falls back to demo mode, with a reason',
    backend(null).mode === 'demo' && backend(null).errors.length === 0 &&
    backend(null).notes.join(' ').includes('demo mode'));

  const placeholder = { SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co', SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLISHABLE-KEY' };
  check('an unedited config.js falls back to demo mode, with a reason',
    backend(placeholder).mode === 'demo' && backend(placeholder).errors.length === 0 &&
    backend(placeholder).notes.join(' ').includes('placeholder'));

  const forceSupabase = Object.assign({}, config, { backend: 'supabase' });
  expectError('backend "supabase" with no config.js', backend(null, forceSupabase).errors, 'there is no config.js');
  expectError('backend "supabase" with an unedited config.js',
    backend(placeholder, forceSupabase).errors, 'still contains the placeholder');

  expectError('a half-filled config.js',
    backend({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: '' }).errors, 'is incomplete');
  expectError('a SUPABASE_URL that is not a URL',
    backend({ SUPABASE_URL: 'abcdefg', SUPABASE_ANON_KEY: REAL_KEY }).errors, 'does not look like a URL');
  expectError('a truncated anon key',
    backend({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'short' }).errors, 'too short');
  expectError('an unknown backend setting',
    backend(null, Object.assign({}, config, { backend: 'postgres' })).errors, 'must be "auto"');

  check('a valid config.js selects the Supabase backend',
    backend({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: REAL_KEY }).mode === 'supabase');

  // The service_role key is a JWT; catching it before it is published is the
  // single highest-value check in this section.
  function jwt(payload) {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload) + '.' + 'c2ln';
  }
  const serviceKey = jwt({ iss: 'supabase', role: 'service_role', exp: 2000000000 });
  const anonKey = jwt({ iss: 'supabase', role: 'anon', exp: 2000000000 });
  check('a service_role key is recognised as one', Validate.looksLikeServiceRoleKey(serviceKey) === true);
  check('an anon key is not mistaken for one', Validate.looksLikeServiceRoleKey(anonKey) === false);
  expectError('pasting the service_role key into config.js is refused',
    backend({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: serviceKey }).errors,
    'SERVICE ROLE key');
  check('a genuine anon JWT is accepted',
    backend({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: anonKey }).mode === 'supabase');

  // --- Supabase connection failures ---
  section('15. Supabase connection failures are diagnosed');

  function diagnose(err) { return StoreSupabase.describeConnectionError(err); }
  function expectKind(label, err, kind, fragment) {
    const d = diagnose(err);
    const okKind = d.kind === kind;
    const okText = !fragment || d.lines.join(' ').toLowerCase().includes(fragment.toLowerCase());
    check(label, okKind && okText, 'kind=' + d.kind + ' lines=' + d.lines.join(' | '));
  }
  expectKind('a wrong project URL / offline browser', new TypeError('Failed to fetch'),
    'unreachable', 'SUPABASE_URL in config.js is wrong');
  expectKind('a paused project is mentioned as a cause', new TypeError('Failed to fetch'),
    'unreachable', 'paused');
  expectKind('a wrong anon key', { message: 'Invalid API key', status: 401 }, 'bad_key', 'anon');
  expectKind('schema.sql never run',
    { message: "Could not find the table 'public.component_windows' in the schema cache", code: 'PGRST205' },
    'no_schema', 'SETUP.md Part 2');
  expectKind('permissions not as expected',
    { message: 'permission denied for table component_windows', code: '42501' }, 'denied', 'verify-setup.sql');
  expectKind('an unrecognised error still gives advice',
    { message: 'something odd' }, 'unknown', 'verify-setup.sql');
  const tmo = StoreSupabase.timeoutDescriptor(StoreSupabase.PROBE_TIMEOUT_MS);
  check('a project that never answers is capped, not left hanging',
    tmo.kind === 'timeout' && tmo.lines.join(' ').includes('did not answer within 15 seconds'),
    tmo.lines.join(' | '));
  check('the connection probe has a sane timeout',
    StoreSupabase.PROBE_TIMEOUT_MS > 2000 && StoreSupabase.PROBE_TIMEOUT_MS <= 30000,
    String(StoreSupabase.PROBE_TIMEOUT_MS));

  check('every diagnosis names the underlying technical detail',
    [new TypeError('Failed to fetch'), { message: 'Invalid API key', status: 401 },
     { message: 'x', code: 'PGRST205' }, { message: 'y', code: '42501' }, { message: 'z' }]
      .every(e => diagnose(e).lines.some(l => l.includes('Technical detail'))));

  /* ---------------------------------------------------- worked example -- */
  // The EXAMPLE folder is documentation that can go stale silently. Check it
  // against the same validators the portal itself uses.
  section('16. The worked example in EXAMPLE/ is deployable');

  const exDir = path.join(ROOT, 'EXAMPLE');
  if (!fs.existsSync(exDir)) {
    check('EXAMPLE/ exists', false, 'folder is missing');
  } else {
    const exConfig = require(path.join(exDir, 'course.config.js'));
    const exErrs = Validate.validateConfig(exConfig);
    check('EXAMPLE/course.config.js is valid', exErrs.length === 0, exErrs.join(' | '));

    const exBanks = {
      questions: Items.loadBank(fs.readFileSync(path.join(exDir, 'questions.csv'), 'utf8'), 'EXAMPLE/questions.csv'),
      feedback: Items.loadBank(fs.readFileSync(path.join(exDir, 'feedback.csv'), 'utf8'), 'EXAMPLE/feedback.csv')
    };
    const exContentErrs = exBanks.questions.errors.concat(exBanks.feedback.errors);
    check('EXAMPLE content files parse cleanly', exContentErrs.length === 0, exContentErrs.join(' | '));

    const exCross = Validate.validateContent(exConfig, exBanks);
    check('EXAMPLE content matches its configuration', exCross.length === 0, exCross.join(' | '));

    check('EXAMPLE has items to compare pre against post',
      exBanks.questions.comparableItems().length >= 3,
      exBanks.questions.comparableItems().length + ' comparable item(s)');
    check('EXAMPLE demonstrates a reverse-scored item',
      exBanks.feedback.items.some(i => i.reverseScored));
    check('EXAMPLE windows are all open, so it works on deployment',
      Object.keys(exConfig.windows).every(k => {
        const w = exConfig.windows[k];
        const CPTZ = require(path.join(ROOT, 'src/tz.js'));
        return CPTZ.windowState(w, exConfig.timezone, Date.now(), null).state === 'open';
      }));
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
