/* ============================================================================
 * src/app.js — the whole user interface.
 *
 * Plain browser JavaScript, no framework and no build step: what is in this
 * repository is exactly what runs. Course-specific behaviour comes from
 * course.config.js and content/*.csv; nothing about any particular course is
 * written here.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var CP = global.CP;
  var TZ = CP.TZ, Items = CP.Items, Scoring = CP.Scoring, Exports = CP.Exports, CSV = CP.CSV;
  var Validate = CP.Validate;

  var config, i18n, store, banks = {}, session = null, windows = {};
  var view = { name: 'home', data: null };
  var root;

  function t(k, v) { return i18n.t(k, v); }

  /* ------------------------------------------------------------------ DOM */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;          // always escaped
      else if (k === 'html') el.innerHTML = v;            // only ever our own markup
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function fmt(ms) {
    return TZ.formatInstant(ms, config.timezone, { locale: i18n.lang === 'ar' ? 'ar-EG' : 'en-GB' });
  }

  /* --------------------------------------------------------------- notices */
  function notice(kind, message) {
    var box = document.getElementById('notice');
    clear(box);
    if (!message) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'notice notice-' + kind;
    box.appendChild(h('span', { text: message }));
    box.appendChild(h('button', { class: 'notice-close', text: '×', 'aria-label': t('close'),
      onclick: function () { notice(null, null); } }));
    box.scrollIntoView({ block: 'nearest' });
  }

  function describeWindow(st) {
    if (st.state === 'open') {
      return st.closesMs ? t('componentOpenUntil', { when: fmt(st.closesMs) }) : t('componentOpen');
    }
    if (st.state === 'before') return t('componentNotOpen', { when: fmt(st.opensMs) });
    if (st.state === 'after')  return t('componentClosed', { when: fmt(st.closesMs) });
    if (st.state === 'closed') return t('componentClosed', { when: '' }).trim();
    return st.reason;
  }

  /* ----------------------------------------------------------------- boot */
  function fetchText(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
      return r.text();
    });
  }

  function boot() {
    root = document.getElementById('app');
    config = global.COURSE_CONFIG;
    i18n = CP.I18n.create(config.language);
    document.documentElement.lang = i18n.lang;
    document.documentElement.dir = i18n.dir;
    document.title = config.courseName + ' — ' + t('appTitle');

    var configErrors = Validate.validateConfig(config);
    if (configErrors.length) return fatal(t('configError'), configErrors);

    return Promise.all([
      fetchContent(config.questionsFile),
      fetchContent(config.feedbackFile)
    ]).then(function (texts) {
      banks.questions = Items.loadBank(texts[0], config.questionsFile);
      banks.feedback = Items.loadBank(texts[1], config.feedbackFile);

      var errs = banks.questions.errors.concat(banks.feedback.errors);
      // Only cross-check the two files against the configuration once each file
      // is individually sound, or the deployer gets a wall of knock-on errors.
      if (!errs.length) errs = Validate.validateContent(config, banks);
      if (errs.length) return fatal(t('contentError'), errs);

      return chooseStore();
    }).then(function () {
      if (!store) return;                       // chooseStore already showed a card
      return refresh();
    });
  }

  /**
   * Fetch one content file, translating the handful of ways this fails into
   * advice rather than an HTTP status nobody outside web development reads.
   */
  function fetchContent(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) {
        throw new Error('The file "' + path + '" was not found. Check the name and location — ' +
          'it must sit exactly where course.config.js says (questionsFile / feedbackFile), ' +
          'relative to index.html. Filenames are case-sensitive on most web hosts.');
      }
      if (!r.ok) throw new Error('The file "' + path + '" could not be read (HTTP ' + r.status + ').');
      return r.text();
    }, function (networkError) {
      // fetch() rejects rather than resolving for file:// and for network faults.
      var isFile = global.location && global.location.protocol === 'file:';
      throw new Error(isFile
        ? 'The portal cannot read "' + path + '" because you opened index.html directly from your ' +
          'file manager. Browsers block that for security. Serve the folder over HTTP instead — ' +
          'run "python3 -m http.server 8000" in this folder and open http://localhost:8000 ' +
          '(SETUP.md Part 0).'
        : 'The file "' + path + '" could not be loaded: ' + (networkError && networkError.message));
    });
  }

  function fatal(title, lines) {
    clear(root);
    root.appendChild(h('div', { class: 'card card-error' }, [
      h('h2', { text: title }),
      h('ul', {}, lines.map(function (l) { return h('li', { text: l }); }))
    ]));
    var b = document.getElementById('demo-banner'); if (b) b.hidden = true;
  }

  function chooseStore() {
    var decision = Validate.chooseBackend(global.APP_CONFIG || null, config);

    if (decision.errors.length) {
      fatal(t('configError'), decision.errors);
      return Promise.resolve();
    }

    if (decision.mode === 'demo') {
      store = CP.StoreDemo.create({ config: config });
      document.getElementById('demo-banner').hidden = false;
      return Promise.resolve();
    }

    var app = global.APP_CONFIG;
    // The Supabase library is fetched ONLY when real credentials are present.
    // In demo mode the portal therefore makes no request for it at all.
    return loadScript('vendor/supabase.js').then(function () {
      if (!global.supabase || !global.supabase.createClient) {
        throw new Error('vendor/supabase.js loaded but did not define window.supabase. ' +
                        'Make sure you saved the UMD build linked in SETUP.md Part 5.');
      }
      var client = global.supabase.createClient(app.SUPABASE_URL, app.SUPABASE_ANON_KEY);
      var candidate = CP.StoreSupabase.create({ config: config, client: client });

      // Say what is happening: the probe can take a few seconds, and a silent
      // "Loading…" is indistinguishable from a hang.
      clear(root);
      root.appendChild(h('p', { class: 'muted', text: 'Connecting to your Supabase project…' }));

      // Ask the database one trivial question before showing anyone a screen,
      // so a wrong URL or missing schema is named now rather than surfacing as
      // an unexplained empty page after someone has typed their password.
      return candidate.probe().then(function (problem) {
        if (problem) {
          fatal(t('configError'), problem.lines);
          return;
        }
        store = candidate;
      });
    }).catch(function (e) {
      fatal(t('configError'), [
        'config.js contains Supabase credentials, but the Supabase client library could not be loaded.',
        String(e && e.message ? e.message : e),
        'Download it once and save it as vendor/supabase.js — see SETUP.md Part 5.'
      ]);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* -------------------------------------------------------------- refresh */
  function componentKeys() {
    var keys = ['registration', 'pre', 'post', 'feedback'];
    (config.days || []).forEach(function (d) { keys.push('attendance_' + d.index); });
    return keys;
  }

  function refresh() {
    return store.currentSession().then(function (s) {
      session = s;
      return Promise.all(componentKeys().map(function (k) {
        return store.windowState(k).then(function (st) { return [k, st]; });
      }));
    }).then(function (pairs) {
      windows = {};
      pairs.forEach(function (p) { windows[p[0]] = p[1]; });
      if (!session) return null;
      return store.myRecords();
    }).then(function (records) {
      session && (session.records = records);
      render();
    });
  }

  /* --------------------------------------------------------------- render */
  function render() {
    clear(root);
    renderHeader();
    if (!session) { view.name = 'auth'; return renderAuth(); }
    if (view.name === 'test') return renderTest(view.data);
    if (view.name === 'feedbackForm') return renderFeedbackForm();
    if (view.name === 'results') return renderResults(view.data);
    if (view.name === 'dashboard') return renderDashboard();
    if (view.name === 'admin') return renderAdmin();
    return renderHome();
  }

  function go(name, data) { view = { name: name, data: data }; notice(null, null); render(); window.scrollTo(0, 0); }

  function renderHeader() {
    var nav = document.getElementById('nav');
    clear(nav);
    if (!session) return;
    function btn(label, name) {
      return h('button', {
        class: 'nav-btn' + (view.name === name ? ' is-current' : ''),
        text: label, onclick: function () { go(name); }
      });
    }
    nav.appendChild(btn(t('navHome'), 'home'));
    nav.appendChild(btn(t('navDashboard'), 'dashboard'));
    if (session.isAdmin) nav.appendChild(btn(t('navAdmin'), 'admin'));
    nav.appendChild(h('button', {
      class: 'nav-btn', text: t('navSignOut'),
      onclick: function () { store.signOut().then(function () { session = null; view = { name: 'home' }; refresh(); }); }
    }));
  }

  /* ----------------------------------------------------------- auth view  */
  function renderAuth() {
    var mode = view.data === 'signup' ? 'signup' : 'signin';
    var regState = windows.registration || { state: 'unconfigured' };
    var canRegister = regState.state === 'open';

    var form = h('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submitAuth(mode, form); } });
    form.appendChild(h('h2', { text: mode === 'signup' ? t('signUp') : t('signIn') }));

    if (mode === 'signup') {
      form.appendChild(field('fullName', t('fullName'), 'text', true));
    }
    form.appendChild(field('email', t('email'), 'email', true));
    form.appendChild(field('password', t('password'), 'password', true,
      mode === 'signup' ? 'new-password' : 'current-password'));
    if (mode === 'signup') {
      form.appendChild(field('password2', t('passwordConfirm'), 'password', true, 'new-password'));
      (config.registrationFields || []).forEach(function (f) {
        form.appendChild(customField(f));
      });
    }

    form.appendChild(h('button', { class: 'btn btn-primary', type: 'submit',
      text: mode === 'signup' ? t('signUp') : t('signIn'),
      disabled: mode === 'signup' && !canRegister }));

    if (mode === 'signup' && !canRegister) {
      form.appendChild(h('p', { class: 'muted', text: describeWindow(regState) }));
    }

    form.appendChild(h('p', { class: 'switch' }, [
      h('button', { class: 'linkish', type: 'button',
        text: mode === 'signup' ? t('haveAccount') : t('noAccount'),
        onclick: function () { go('auth', mode === 'signup' ? 'signin' : 'signup'); } })
    ]));

    root.appendChild(h('div', { class: 'intro' }, [
      h('h1', { text: config.courseName }),
      h('p', { class: 'muted', text: config.organisation }),
      h('p', { class: 'muted', text: t('allTimesIn', { tz: config.timezone }) })
    ]));
    root.appendChild(form);
  }

  function field(name, label, type, required, autocomplete) {
    var id = 'f_' + name;
    return h('label', { class: 'field', for: id }, [
      h('span', { class: 'field-label' }, [
        document.createTextNode(label),
        required ? h('em', { class: 'req', text: ' ' + t('requiredMark') }) : null
      ]),
      h('input', { id: id, name: name, type: type, required: !!required,
        autocomplete: autocomplete || (type === 'email' ? 'email' : 'on') })
    ]);
  }

  function customField(f) {
    var id = 'f_' + f.key;
    var input;
    if (f.type === 'select') {
      input = h('select', { id: id, name: f.key, required: !!f.required },
        [h('option', { value: '', text: '—' })].concat((f.options || []).map(function (o) {
          return h('option', { value: o, text: o });
        })));
    } else {
      input = h('input', { id: id, name: f.key, required: !!f.required,
        type: f.type === 'number' ? 'number' : (f.type === 'tel' ? 'tel' : 'text'),
        min: f.type === 'number' ? '0' : null });
    }
    return h('label', { class: 'field', for: id }, [
      h('span', { class: 'field-label' }, [
        document.createTextNode(f.label),
        f.required ? h('em', { class: 'req', text: ' ' + t('requiredMark') }) : null
      ]),
      input
    ]);
  }

  function submitAuth(mode, form) {
    var data = new FormData(form);
    var email = String(data.get('email') || '').trim();
    var password = String(data.get('password') || '');
    var button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = mode === 'signup' ? t('registering') : t('signingIn');

    function done() { button.disabled = false; button.textContent = mode === 'signup' ? t('signUp') : t('signIn'); }

    if (mode === 'signup') {
      var pw2 = String(data.get('password2') || '');
      var problem = passwordProblem(password, pw2);
      if (problem) { notice('error', problem); done(); return; }

      var demographics = {};
      (config.registrationFields || []).forEach(function (f) {
        var v = data.get(f.key);
        if (v !== null && String(v).trim() !== '') demographics[f.key] = String(v).trim();
      });

      store.signUp({
        email: email, password: password,
        fullName: String(data.get('fullName') || '').trim(),
        demographics: demographics
      }).then(function (res) {
        if (res.needsEmailConfirmation) {
          done();
          view = { name: 'auth', data: 'signin' };
          render();
          notice('info', t('confirmEmailNotice', { email: email }));
          return;
        }
        view = { name: 'home' };
        notice(null, null);          // clear any earlier validation message
        return refresh();
      }).catch(function (e) { notice('error', authMessage(e)); done(); });
      return;
    }

    store.signIn({ email: email, password: password }).then(function () {
      view = { name: 'home' };
      notice(null, null);
      return refresh();
    }).catch(function (e) { notice('error', authMessage(e)); done(); });
  }

  var MIN_PASSWORD = 10;
  function passwordProblem(pw, pw2) {
    if (pw.length < MIN_PASSWORD) return t('passwordTooShort', { n: MIN_PASSWORD });
    if (pw !== pw2) return t('passwordsDiffer');
    // Require some variety, not a rigid character-class rule.
    var classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/[0-9]/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    if (classes < 2) return t('passwordWeak', { n: MIN_PASSWORD });
    return null;
  }

  function authMessage(e) {
    var code = e && e.code;
    if (code === 'EMAIL_IN_USE') return t('emailInUse');
    if (code === 'BAD_CREDENTIALS') return t('signInFailed');
    if (code === 'EMAIL_NOT_CONFIRMED') return t('emailNotConfirmed');
    if (code === 'WINDOW_CLOSED') return t('registrationClosed');
    return (e && e.message) || t('error');
  }

  /* ----------------------------------------------------------- home view  */
  function recordsOf() {
    return (session && session.records) || { attendance: [], submissions: [], answers: [], feedback: [], feedbackAnswers: [] };
  }
  function hasSubmission(phase) {
    return recordsOf().submissions.some(function (s) { return s.phase === phase; });
  }
  function hasFeedback() { return recordsOf().feedback.length > 0; }
  function attendedDay(i) {
    return recordsOf().attendance.some(function (a) { return Number(a.day_index) === Number(i); });
  }
  function attendanceRecord(i) {
    return recordsOf().attendance.filter(function (a) { return Number(a.day_index) === Number(i); })[0];
  }

  function renderHome() {
    root.appendChild(h('div', { class: 'intro' }, [
      h('h1', { text: config.courseName }),
      h('p', { class: 'muted', text: config.organisation })
    ]));

    root.appendChild(h('div', { class: 'card code-card' }, [
      h('div', { class: 'code-label', text: t('yourCode') }),
      h('div', { class: 'code-value', text: session.participant.participant_code }),
      h('p', { class: 'muted', text: t('yourCodeExplain') })
    ]));

    var list = h('div', { class: 'components' });

    // Attendance, one row per configured day.
    (config.days || []).forEach(function (d) {
      var key = 'attendance_' + d.index;
      var st = windows[key] || { state: 'unconfigured', reason: '' };
      var done = attendedDay(d.index);
      var rec = attendanceRecord(d.index);
      list.appendChild(componentCard({
        title: d.title,
        subtitle: t('attendance') + (d.date ? ' · ' + d.date : ''),
        state: st,
        done: done,
        doneText: done && rec ? t('attendanceRecorded', { when: fmt(Date.parse(rec.checked_in_at)) }) : t('attendanceNotRecorded'),
        actionLabel: t('attendanceCheckIn'),
        onAction: function (btn) {
          btn.disabled = true;
          store.checkIn(d.index).then(function () {
            return refresh();
          }).then(function () { notice('success', t('attendanceDone')); })
            .catch(function (e) { notice('error', errMessage(e)); btn.disabled = false; });
        }
      }));
    });

    // Pre-test, post-test, feedback.
    [['pre', t('preTest')], ['post', t('postTest')]].forEach(function (pair) {
      var phase = pair[0];
      var st = windows[phase] || { state: 'unconfigured', reason: '' };
      var done = hasSubmission(phase);
      list.appendChild(componentCard({
        title: pair[1],
        subtitle: t('questionCount', { n: banks.questions.forPhase(phase).length }),
        state: st, done: done,
        doneText: done ? t('alreadySubmitted') : '',
        actionLabel: t('startTest'),
        onAction: function () { go('test', phase); },
        extra: done && phase === 'post' && config.showImmediateResults
          ? h('button', { class: 'btn btn-quiet', text: t('resultsTitle'),
              onclick: function () { go('results', buildComparison()); } })
          : null
      }));
    });

    var fst = windows.feedback || { state: 'unconfigured', reason: '' };
    list.appendChild(componentCard({
      title: t('feedback'),
      subtitle: t('questionCount', { n: banks.feedback.forPhase('feedback').length }),
      state: fst, done: hasFeedback(),
      doneText: hasFeedback() ? t('alreadySubmitted') : '',
      actionLabel: t('startTest'),
      onAction: function () { go('feedbackForm'); }
    }));

    root.appendChild(list);
    root.appendChild(h('p', { class: 'muted tz-note', text: t('allTimesIn', { tz: config.timezone }) }));
  }

  function componentCard(o) {
    var open = o.state.state === 'open';
    var badge = o.done ? 'done' : (open ? 'open' : 'shut');
    var card = h('div', { class: 'card component is-' + badge });
    card.appendChild(h('div', { class: 'component-head' }, [
      h('h3', { text: o.title }),
      h('span', { class: 'badge badge-' + badge,
        text: o.done ? t('statusDone') : (open ? t('componentOpen').replace(/\.$/, '') : t('statusPending')) })
    ]));
    if (o.subtitle) card.appendChild(h('p', { class: 'muted', text: o.subtitle }));
    card.appendChild(h('p', { class: 'muted', text: describeWindow(o.state) }));
    if (o.done) {
      if (o.doneText) card.appendChild(h('p', { class: 'done-text', text: o.doneText }));
    } else if (open) {
      var btn = h('button', { class: 'btn btn-primary', text: o.actionLabel });
      btn.addEventListener('click', function () { o.onAction(btn); });
      card.appendChild(btn);
    }
    if (o.extra) card.appendChild(o.extra);
    return card;
  }

  function errMessage(e) {
    if (!e) return t('error');
    if (e.code === 'ALREADY_SUBMITTED') return t('alreadySubmitted');
    if (e.code === 'WINDOW_CLOSED') return e.message || t('error');
    return e.message || t('error');
  }

  /* ----------------------------------------------------------- test view  */
  function renderTest(phase) {
    if (hasSubmission(phase)) { go('home'); return notice('info', t('alreadySubmitted')); }
    var items = banks.questions.forPhase(phase);
    var startedAt = Date.now();
    renderQuestionForm({
      title: phase === 'pre' ? t('preTest') : t('postTest'),
      items: items,
      onSubmit: function (answers, button) {
        var score = Scoring.scoreSubmission(items, answers);
        var duration = Math.round((Date.now() - startedAt) / 1000);
        button.disabled = true; button.textContent = t('submitting');
        store.submitTest(phase, answers, score, duration).then(function () {
          return refresh();
        }).then(function () {
          if (phase === 'post' && config.showImmediateResults) {
            go('results', buildComparison());
            return;
          }
          go('home');
          notice('success', phase === 'pre' && !config.showPreTestScore
            ? t('resultsHiddenPre') : t('submitted'));
        }).catch(function (e) {
          notice('error', errMessage(e));
          button.disabled = false; button.textContent = t('submit');
        });
      }
    });
  }

  function renderFeedbackForm() {
    if (hasFeedback()) { go('home'); return notice('info', t('alreadySubmitted')); }
    var items = banks.feedback.forPhase('feedback');
    renderQuestionForm({
      title: t('feedback'),
      items: items,
      onSubmit: function (answers, button) {
        button.disabled = true; button.textContent = t('submitting');
        store.submitFeedback(answers).then(function () {
          return refresh();
        }).then(function () { go('home'); notice('success', t('submitted')); })
          .catch(function (e) {
            notice('error', errMessage(e));
            button.disabled = false; button.textContent = t('submit');
          });
      }
    });
  }

  /**
   * Renders any list of items. Every question is required except free-text
   * ones, which are always optional — nobody should be blocked from submitting
   * because they had nothing to write.
   */
  function renderQuestionForm(o) {
    var answers = {};
    var form = h('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); } });
    form.appendChild(h('h2', { text: o.title }));

    o.items.forEach(function (item, n) {
      var block = h('fieldset', { class: 'question' });
      block.appendChild(h('legend', {}, [
        h('span', { class: 'qnum', text: String(n + 1) + '.' }),
        h('span', { text: ' ' + item.stem })
      ]));

      if (item.type === 'mcq') {
        item.options.forEach(function (opt) {
          var id = 'q_' + item.id + '_' + opt.letter;
          block.appendChild(h('label', { class: 'choice', for: id }, [
            h('input', { type: 'radio', id: id, name: 'q_' + item.id, value: opt.letter,
              onchange: function () { answers[item.id] = opt.letter; } }),
            h('span', { text: opt.text })
          ]));
        });
      } else if (item.type === 'likert') {
        var scale = h('div', { class: 'likert' });
        Items.LIKERT_SCALE.forEach(function (pt) {
          var id = 'q_' + item.id + '_' + pt.value;
          scale.appendChild(h('label', { class: 'likert-point', for: id }, [
            h('input', { type: 'radio', id: id, name: 'q_' + item.id, value: pt.value,
              onchange: function () { answers[item.id] = String(pt.value); } }),
            h('span', { class: 'likert-num', text: String(pt.value) }),
            h('span', { class: 'likert-text', text: t(pt.key) })
          ]));
        });
        block.appendChild(scale);
      } else {
        block.appendChild(h('textarea', {
          rows: '3', name: 'q_' + item.id, 'aria-label': item.stem,
          oninput: function (e) { answers[item.id] = e.target.value; }
        }));
      }
      form.appendChild(block);
    });

    var submit = h('button', { class: 'btn btn-primary', type: 'button', text: t('submit') });
    submit.addEventListener('click', function () {
      var missing = o.items.filter(function (it) {
        return it.type !== 'text' && !answers[it.id];
      });
      if (missing.length) {
        notice('error', t('unanswered', { n: missing.length }));
        var el = form.querySelector('[name="q_' + missing[0].id + '"]');
        if (el) el.scrollIntoView({ block: 'center' });
        return;
      }
      if (!window.confirm(t('confirmSubmit'))) return;
      o.onSubmit(answers, submit);
    });
    form.appendChild(submit);
    form.appendChild(h('button', { class: 'btn btn-quiet', type: 'button', text: t('back'),
      onclick: function () { go('home'); } }));

    root.appendChild(form);
  }

  /* -------------------------------------------------------- results view  */
  function buildComparison() {
    var r = recordsOf();
    var pre = {}, post = {};
    r.answers.forEach(function (a) {
      (a.phase === 'pre' ? pre : post)[a.item_id] = a.response;
    });
    return Scoring.comparePrePost(banks.questions.comparableItems(), pre, post);
  }

  function renderResults(cmp) {
    if (!cmp) return go('home');
    var card = h('div', { class: 'card' });
    card.appendChild(h('h2', { text: t('resultsTitle') }));
    card.appendChild(h('p', { class: 'muted', text: t('resultsBasis', { n: cmp.comparableCount }) }));

    card.appendChild(h('div', { class: 'scoreboard' }, [
      scoreTile(t('resultsPre'), cmp.pre.percent, cmp.pre.raw + '/' + cmp.pre.max),
      scoreTile(t('resultsPost'), cmp.post.percent, cmp.post.raw + '/' + cmp.post.max),
      scoreTile(t('resultsChange'),
        (cmp.changePoints > 0 ? '+' : '') + cmp.changePoints,
        (cmp.normalisedGain === null ? '' : 'g = ' + cmp.normalisedGain), true)
    ]));

    card.appendChild(h('ul', { class: 'movement' }, [
      h('li', { text: t('resultsGained') + ': ' + cmp.counts.gained }),
      h('li', { text: t('resultsKept') + ': ' + cmp.counts.kept }),
      h('li', { text: t('resultsLost') + ': ' + cmp.counts.lost }),
      h('li', { text: t('resultsUnchanged') + ': ' + cmp.counts.unchanged })
    ]));

    if (config.showPerItemReview) {
      card.appendChild(h('h3', { text: t('reviewTitle') }));
      cmp.items.forEach(function (it, n) {
        card.appendChild(h('div', { class: 'review review-' + it.movement }, [
          h('p', { class: 'review-stem', text: (n + 1) + '. ' + it.stem }),
          reviewLine(t('yourAnswerPre'), it.pre),
          reviewLine(t('yourAnswerPost'), it.post),
          h('p', { class: 'review-key', text: t('correctAnswer') + ': ' + it.answerText })
        ]));
      });
    }

    card.appendChild(h('button', { class: 'btn btn-quiet', text: t('back'),
      onclick: function () { go('home'); } }));
    root.appendChild(card);
  }

  function reviewLine(label, a) {
    var mark = a.isCorrect === true ? '✓' : (a.isCorrect === false ? '✗' : '·');
    return h('p', { class: 'review-answer ' + (a.isCorrect ? 'is-correct' : 'is-wrong') },
      [h('span', { class: 'mark', text: mark }),
       h('span', { text: ' ' + label + ': ' + (a.text || t('notAnswered')) })]);
  }

  function scoreTile(label, value, sub, plain) {
    return h('div', { class: 'tile' }, [
      h('div', { class: 'tile-label', text: label }),
      h('div', { class: 'tile-value', text: value === null || value === undefined || value === '' ? '—' : (plain ? String(value) : value + '%') }),
      sub ? h('div', { class: 'tile-sub', text: sub }) : null
    ]);
  }

  /* ------------------------------------------------------ dashboard view  */
  function localEligibility() {
    var r = recordsOf();
    var post = r.submissions.filter(function (s) { return s.phase === 'post'; })[0];
    return Scoring.certificateEligibility(config.certificate || {}, {
      registered: true,
      preDone: hasSubmission('pre'),
      postDone: hasSubmission('post'),
      feedbackDone: hasFeedback(),
      attendanceDays: r.attendance.length,
      postPercent: post ? Number(post.score_percent) : null
    }, (config.days || []).length);
  }

  function renderDashboard() {
    var elig = localEligibility();
    var card = h('div', { class: 'card' });
    card.appendChild(h('h2', { text: t('dashboard') }));
    card.appendChild(h('p', { class: 'code-inline', text: t('yourCode') + ': ' + session.participant.participant_code }));

    var tbl = h('table', { class: 'table' });
    tbl.appendChild(h('thead', {}, [h('tr', {}, [
      h('th', { text: t('progress') }), h('th', { text: '' })
    ])]));
    var tb = h('tbody');
    (config.days || []).forEach(function (d) {
      var rec = attendanceRecord(d.index);
      tb.appendChild(h('tr', {}, [
        h('td', { text: d.title }),
        h('td', { text: rec ? t('attendanceRecorded', { when: fmt(Date.parse(rec.checked_in_at)) }) : t('attendanceNotRecorded') })
      ]));
    });
    [['pre', t('preTest')], ['post', t('postTest')]].forEach(function (p) {
      var s = recordsOf().submissions.filter(function (x) { return x.phase === p[0]; })[0];
      var text = t('statusPending');
      if (s) {
        var showScore = p[0] === 'post' ? true : !!config.showPreTestScore;
        text = t('statusDone') + (showScore && s.score_percent !== null ? ' — ' + s.score_percent + '%' : '');
      }
      tb.appendChild(h('tr', {}, [h('td', { text: p[1] }), h('td', { text: text })]));
    });
    tb.appendChild(h('tr', {}, [
      h('td', { text: t('feedback') }),
      h('td', { text: hasFeedback() ? t('statusDone') : t('statusPending') })
    ]));
    tbl.appendChild(tb);
    card.appendChild(tbl);

    var cert = h('div', { class: 'card cert ' + (elig.eligible ? 'cert-yes' : 'cert-no') });
    cert.appendChild(h('h3', { text: t('certificate') }));
    if (elig.eligible) {
      cert.appendChild(h('p', { text: t('certificateEligible') }));
    } else {
      cert.appendChild(h('p', { text: t('certificateNotEligible') }));
      cert.appendChild(h('ul', {}, elig.outstanding.map(function (o) { return h('li', { text: o }); })));
    }
    cert.appendChild(h('ul', { class: 'checklist' }, elig.checks.map(function (c) {
      return h('li', { class: c.met ? 'met' : 'unmet', text: (c.met ? '✓ ' : '· ') + c.label + ' (' + c.detail + ')' });
    })));
    cert.appendChild(h('p', { class: 'muted', text: t('certificateNote') }));

    root.appendChild(card);
    root.appendChild(cert);
  }

  /* ---------------------------------------------------------- admin view  */
  function renderAdmin() {
    if (!session.isAdmin) { go('home'); return notice('error', t('adminNoAccess')); }

    root.appendChild(h('h2', { text: t('adminTitle') }));

    /* --- windows --- */
    var wcard = h('div', { class: 'card' });
    wcard.appendChild(h('h3', { text: t('adminWindows') }));
    var wt = h('table', { class: 'table' });
    wt.appendChild(h('thead', {}, [h('tr', {}, [
      h('th', { text: 'Component' }), h('th', { text: t('adminScheduled') }),
      h('th', { text: t('adminEffective') }), h('th', { text: '' })
    ])]));
    var wb = h('tbody');
    componentKeys().forEach(function (key) {
      var st = windows[key] || { state: 'unconfigured', reason: '' };
      wb.appendChild(h('tr', {}, [
        h('td', { text: key }),
        h('td', { class: 'nowrap', text: (st.opensMs ? fmt(st.opensMs) : '—') + ' → ' + (st.closesMs ? fmt(st.closesMs) : '—') }),
        h('td', {}, [h('span', { class: 'badge badge-' + (st.state === 'open' ? 'open' : 'shut'), text: st.state })]),
        h('td', {}, [
          overrideBtn(key, true, t('adminOverrideOpen')),
          overrideBtn(key, false, t('adminOverrideClose')),
          overrideBtn(key, null, t('adminOverrideAuto'))
        ])
      ]));
    });
    wt.appendChild(wb);
    wcard.appendChild(wt);
    wcard.appendChild(h('button', { class: 'btn', text: t('adminSync'), onclick: function (e) {
      var b = e.target; b.disabled = true;
      store.publishSchedule().then(function () { return refresh(); })
        .then(function () { notice('success', t('adminSyncDone')); })
        .catch(function (err) { notice('error', errMessage(err)); b.disabled = false; });
    } }));
    wcard.appendChild(h('p', { class: 'muted', text: t('allTimesIn', { tz: config.timezone }) }));
    root.appendChild(wcard);

    /* --- participants + exports --- */
    var pcard = h('div', { class: 'card' });
    pcard.appendChild(h('h3', { text: t('adminProgress') }));
    pcard.appendChild(h('p', { class: 'muted', text: t('loading') }));
    root.appendChild(pcard);

    store.fullDataset().then(function (dataset) {
      clear(pcard);
      pcard.appendChild(h('h3', { text: t('adminProgress') }));
      pcard.appendChild(h('p', { class: 'muted', text: t('adminCounts', { n: dataset.participants.length }) }));

      var ops = Exports.buildOperations(dataset, banks, config);
      var tbl = h('table', { class: 'table table-scroll' });
      tbl.appendChild(h('thead', {}, [h('tr', {}, ops.columns.map(function (c) {
        return h('th', { text: c });
      }))]));
      tbl.appendChild(h('tbody', {}, ops.rows.map(function (r) {
        return h('tr', {}, ops.columns.map(function (c) { return h('td', { text: String(r[c]) }); }));
      })));
      pcard.appendChild(h('div', { class: 'scroller' }, [tbl]));

      var ex = h('div', { class: 'card' });
      ex.appendChild(h('h3', { text: t('adminExports') }));
      ex.appendChild(h('p', { class: 'muted', text:
        'The research file contains no names, no email addresses and no field marked as an identifier. ' +
        'The operations file contains identifiers and is for course administration only.' }));
      ex.appendChild(exportButton(t('adminExportResearch'), 'primary', function () {
        var res = Exports.buildResearch(dataset, banks, config);
        Exports.assertDeidentified(res, config);          // refuses rather than leaks
        return [res, 'research'];
      }));
      ex.appendChild(exportButton(t('adminExportOperations'), '', function () {
        return [Exports.buildOperations(dataset, banks, config), 'operations'];
      }));
      ex.appendChild(h('p', {}, [
        h('button', { class: 'btn btn-quiet', text: t('adminExportDictionary') + ' (research)',
          onclick: function () {
            var res = Exports.buildResearch(dataset, banks, config);
            download(slug() + '_research_dictionary.csv', Exports.dictionaryToCSV(res));
          } }),
        h('button', { class: 'btn btn-quiet', text: t('adminExportDictionary') + ' (operations)',
          onclick: function () {
            var o = Exports.buildOperations(dataset, banks, config);
            download(slug() + '_operations_dictionary.csv', Exports.dictionaryToCSV(o));
          } })
      ]));
      root.appendChild(ex);
    }).catch(function (e) {
      clear(pcard);
      pcard.appendChild(h('p', { class: 'error-text', text: errMessage(e) }));
    });
  }

  function exportButton(label, kind, build) {
    return h('button', { class: 'btn ' + (kind === 'primary' ? 'btn-primary' : ''), text: label,
      onclick: function () {
        try {
          var out = build();
          download(slug() + '_' + out[1] + '_' + stamp() + '.csv', Exports.toCSV(out[0]));
        } catch (e) { notice('error', e.message); }
      } });
  }

  function overrideBtn(key, value, label) {
    return h('button', { class: 'btn btn-tiny', text: label, onclick: function (e) {
      var b = e.target; b.disabled = true;
      store.setOverride(key, value).then(function () { return refresh(); })
        .catch(function (err) { notice('error', errMessage(err)); b.disabled = false; });
    } });
  }

  function slug() {
    return String(config.courseShortName || 'course').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function stamp() {
    return TZ.dateKey(Date.now(), config.timezone);
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------------------------------------------------------- demo reset  */
  function wireDemoBanner() {
    var b = document.getElementById('demo-reset');
    if (!b) return;
    b.addEventListener('click', function () {
      if (!window.confirm(t('demoResetConfirm'))) return;
      store.reset().then(function () { session = null; view = { name: 'home' }; return refresh(); });
    });
  }

  /** Last-resort renderer for a failure that happens before the UI exists. */
  function bareFatal(lines) {
    var el = document.getElementById('app');
    if (!el) return;
    clear(el);
    var card = h('div', { class: 'card card-error' }, [h('h2', { text: 'Configuration problem' })]);
    card.appendChild(h('ul', {}, lines.map(function (l) { return h('li', { text: l }); })));
    el.appendChild(card);
    var b = document.getElementById('demo-banner'); if (b) b.hidden = true;
  }

  global.CP.App = {
    start: function () {
      // Promise.resolve().then(boot) so that a SYNCHRONOUS throw inside boot()
      // still lands in the catch below rather than escaping and leaving the
      // page stuck on "Loading…".
      Promise.resolve().then(boot).then(function () {
        var banner = document.getElementById('demo-banner');
        if (banner && !banner.hidden) {
          document.getElementById('demo-banner-text').textContent = i18n.t('demoBanner');
          document.getElementById('demo-reset').textContent = i18n.t('demoReset');
          wireDemoBanner();
        }
      }).catch(function (e) {
        bareFatal([
          'The portal could not start.',
          String(e && e.message ? e.message : e),
          'Check course.config.js — most often this is a mistyped timezone name or a malformed date.'
        ]);
      });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
