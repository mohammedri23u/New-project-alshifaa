# Course Portal

A small, self-contained web portal for running a short course (1–5 days) with
**registration, per-day attendance, a pre-test, a post-test and feedback — all
linked to one participant code per learner.**

It exists to solve one problem well: at the end of a course you want a single
table, one row per participant, in which the pre-test, the post-test, the
attendance record and the feedback all belong to the same person — without
having to hold names next to answers, and without matching spreadsheets by
hand afterwards.

Static HTML, CSS and JavaScript plus a Supabase database. No build step, no
framework, no package to install. What is in this repository is what runs.

---

## Try it in two minutes

```
python3 -m http.server 8000
```

Open <http://localhost:8000>. With no `config.js` present the portal starts in
**demo mode**, storing everything in your browser — no account, no server, no
database. Register, check in, sit both tests, leave feedback, and download the
exports. The first account you create gets the admin console.

For a real course, follow [SETUP.md](SETUP.md).

---

## What it does

- **Server-issued participant codes.** A database trigger assigns `CP-0001`,
  `CP-0002`, … on registration. Learners never see a code entry box, cannot
  choose one, and cannot change it. Every record they create carries it.
- **Registration** with whatever demographic fields you configure.
- **Per-day attendance check-in**, in windows you set, and can force open or
  closed on the day.
- **Pre-test and post-test** built from a CSV file you edit, with an immediate
  pre-versus-post report and per-item review afterwards (both switchable off).
- **Feedback form** with Likert, multiple-choice and free-text items, and
  automatic reverse-scoring for negatively-worded items.
- **A personal status page** showing exactly what each learner has left to do.
- **Server-computed certificate eligibility** against a rule you configure.
- **An admin console** for opening and closing windows, watching progress and
  exporting.
- **Two exports** — one de-identified for analysis, one with identifiers for
  administration — both wide, one row per participant, each with a generated
  column dictionary. See [docs/EXPORTS.md](docs/EXPORTS.md).
- **English and Arabic** interfaces, with right-to-left layout.

Everything specific to a course is configuration:
[`course.config.js`](course.config.js) for the course, dates, timezone,
certificate rule and registration fields;
[`content/questions.csv`](content/questions.csv) and
[`content/feedback.csv`](content/feedback.csv) for the questions. There are no
questions, day names, or course details hard-coded anywhere in the source.

---

## What it does **not** do

Being clear about this saves everyone time:

- **It is not a learning management system.** No lessons, no modules, no
  gradebook, no discussion, no assignments, no groups.
- **It does not host video, slides or any other content.** Link to them from
  wherever you already keep them.
- **It sends no messages.** No reminder emails, no SMS, no push notifications,
  no "you have not done the post-test yet" nudges. The only email it ever sends
  is the sign-up confirmation and password reset that Supabase itself sends. If
  you want to chase people, use the operations export and your own mail merge.
- **It does not issue certificates.** It computes *eligibility* and shows it.
  Producing and signing the actual certificate is your job.
- **It is not an exam system.** The answer key is downloaded by the browser, so
  a learner can read it. Fine for formative pre/post testing; unsuitable for
  anything high-stakes. See [docs/SECURITY.md](docs/SECURITY.md).
- **It does no statistics.** It gives you a clean, analysis-ready table. Bring
  your own R, Stata, SPSS or Python.
- **It does not scale to thousands.** The admin console loads every record into
  the browser to build the exports. Comfortable to a few hundred participants;
  beyond that, query the database directly.
- **No AI, anywhere.** Scoring is arithmetic. Nothing is sent to a model at any
  point, and there is no telemetry of any kind.

---

## Honest limitations

Read [docs/SECURITY.md](docs/SECURITY.md#known-limitations--please-read-before-using-this-with-real-data)
in full before using this with real participants. In brief:

- The answer key is visible to anyone who looks at the downloaded CSV.
- Scores are computed in the browser and could be falsified. The raw responses
  are stored and the exports recompute every score from them, so analysis is
  unaffected — but the live admin table could show a wrong figure.
- Duration data measures wall-clock time in a browser tab, not effort.
- Demo mode has no security boundary at all. It is for trying the tool.
- Deleting a withdrawn participant is a manual step in the Supabase dashboard.
- A de-identified file from a small course with rich demographics may still be
  re-identifiable. Review your fields before sharing.
- Supabase's built-in mailer is rate-limited; a course of any size needs its own
  SMTP configured, or confirmation emails will not arrive.

---

## Repository layout

```
index.html              the entire application shell
course.config.js        ← your course: dates, timezone, days, certificate rule
config.sample.js        copy to config.js and add your Supabase keys (gitignored)
content/
  questions.csv         ← your pre/post test items
  feedback.csv          ← your feedback items
  README.md             the CSV column specification
src/
  tz.js                 timezone-correct conversion (browser ↔ database)
  csv.js                CSV reading and writing
  items.js              CSV → validated items, with clear error reporting
  scoring.js            scoring, pre/post comparison, certificate eligibility
  exports.js            the two exports and their column dictionaries
  i18n.js               interface strings (en, ar)
  store-demo.js         the localStorage backend used by demo mode
  store-supabase.js     the real backend
  app.js                the user interface
  styles.css
supabase/schema.sql     the whole database: tables, RLS, triggers, views
tools/selftest.js       end-to-end check of your configuration and content
vendor/                 where you save supabase.js (see vendor/README.md)
docs/
  SECURITY.md           threat model, guarantees, and honest limitations
  EXPORTS.md            what is in each export and how to analyse it
SETUP.md                zero to running, written for a non-programmer
```

---

## Checking your setup

```
node tools/selftest.js           # runs the real modules end to end
node tools/selftest.js --write   # also writes sample exports to exports/
```

It drives registration, attendance, both tests, feedback, eligibility and both
exports against your actual `course.config.js` and `content/*.csv`, and reports
problems in plain English. Run it after editing either. It needs Node, but
nothing installed — no dependencies.

---

## Time zones

Every configured time is written as plain local wall-clock time in the course's
own timezone (`'2026-09-07T09:30'`), and the timezone is named once
(`timezone: 'Africa/Cairo'`). The browser converts using that name; the database
converts using the same name with `AT TIME ZONE`. Both therefore mean the same
instant, and daylight-saving changes are handled correctly by both.

This is worth stating because the obvious shortcut — comparing the browser's
local clock against a fixed `+03` offset stored in the database — silently
breaks for any participant whose device is set to another timezone, and for
everyone twice a year.

After changing any time in `course.config.js`, click **Publish schedule to
server** in the admin console so the database enforces what the pages show.

---

## Contributing

Issues and pull requests are welcome. Two things to keep in mind:

1. **Nothing course-specific goes in the source.** If you find yourself typing a
   date, a question, or an institution name into a `.js` file, it belongs in
   `course.config.js` or a CSV.
2. **`docs/SECURITY.md` lists six flaws that were designed out.** Please do not
   reintroduce them.

## Citation

If this tool supports work you publish, please cite the accompanying paper on
participant-level record linkage in short-course evaluation, and note the
repository and commit you used.

## License

MIT — see [LICENSE](LICENSE). Use it, change it, run your own course with it.
