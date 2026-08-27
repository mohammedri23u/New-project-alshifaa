# Security and privacy

This portal collects identifiable data about real people. This document states
plainly what it protects, how, and what it does **not** protect.

## The threat model

Assume the portal URL is public, the `anon` key is public (it is — it ships in
`config.js` and anyone can read it), and some participants are curious and
technically capable. The database, not the browser, has to be what stops them.

## Six flaws that were designed out

The portal this was generalised from had a number of serious problems. They are
listed here because they are common in course portals generally, and because a
future contributor should know they are deliberate absences, not oversights.

### 1. No shared or default password

Every learner sets their own password at registration (minimum 10 characters,
at least two character classes, confirmed twice). There is no constant anywhere
in this repository holding a password, and no code path that assigns one.

*Why it matters:* a shared default password means anyone who knows it can sign
in as anyone else, so no record can be attributed to a particular person, and
consent to participate becomes unverifiable.

### 2. No public participant directory

There is no function, view, table or endpoint that returns a list of
participants — by name, by email, or at all — to an unauthenticated visitor.
Sign-in is by email address and password only.

Anonymous visitors can read exactly one thing: the timetable
(`component_windows`), which contains no personal data. Everything else is
refused at the SQL grant level, before Row Level Security is even consulted.

*Why it matters:* a "search for your name to log in" directory publishes your
entire participant list — names, and often email addresses — to the open
internet. It is also an enumeration oracle for the login system.

### 3. Email confirmation is on by default

`SETUP.md` Part 3 makes turning it on an explicit, checked step, and explains
that disabling it is a testing-only measure to be reversed before real
participants are invited.

*Why it matters:* without confirmation, anyone can register using someone
else's address, and your export contains records attributed to a person who
never took part.

### 4. No bulk password operations

There is no script that resets, sets, or emails passwords in bulk, and no
administrator function that reads or changes another person's password.
Password recovery is Supabase's own emailed reset link, which only the owner of
the mailbox can use.

*Why it matters:* a bulk-reset script is a single file that compromises every
account at once, and it is usually kept in the repository with a password in it.

### 5. Row Level Security on every table

Every table has RLS enabled and is deny-by-default: an operation with no
matching policy is refused for everyone.

- A learner may read only rows where `participant_id = auth.uid()`.
- A learner may insert their own rows, and **only while the relevant window is
  open** — the policy itself calls `component_is_open()`.
- Submissions have **no UPDATE policy at all**, so an answer cannot be edited
  after the fact by anyone using the anon key.
- Administrator status is membership of the `admins` table. There is no INSERT
  policy on it, so it can only be granted from the SQL editor by whoever holds
  the database password.

Function privileges are locked down too. PostgreSQL grants `EXECUTE` on a new
function to `PUBLIC` automatically, which would have let the anonymous role call
the submission functions. They each refuse a null `auth.uid()`, so it was never
exploitable — but `schema.sql` now revokes every function from `PUBLIC` and
grants back only what each role needs. The anonymous role can call exactly one
function, `component_is_open()`, which reveals whether registration is open —
information already printed on the landing page.

These properties are tested, not asserted — see "Verification" below.

### 6. Secrets are not in the repository

`config.js` is gitignored; only `config.sample.js` is committed. The sample
file states which key to use and warns against the `service_role` key.

## Other properties

**The participant code is issued by the server.** A database trigger assigns it
on insert, and a second trigger restores the old value on any update, so the
code cannot be chosen, guessed into, or changed — not by a learner, and not by
an administrator using the portal. This is what makes the code trustworthy as a
linkage key.

**Windows are enforced by the database.** The UI hides a closed component, but
that is a convenience. A crafted request is refused by both the RLS policy and
the submission function.

**Scores are recomputed at export.** The browser sends an `is_correct` flag;
nothing important trusts it. See `docs/EXPORTS.md`.

**No third parties.** No analytics, no fonts, no trackers, no CDN, no runtime
AI. With `vendor/supabase.js` saved locally (SETUP Part 5), the only host the
page ever contacts is your own Supabase project.

## Verification

### Check your own deployment: `tools/verify-setup.sql`

Paste it into the Supabase SQL editor after running `schema.sql`. It is
read-only and prints a PASS/FAIL line for each of: every expected table and
column; RLS enabled on every table; the policy count per table; exactly which
relations and functions the anonymous role can reach; the absence of any
`UPDATE`/`DELETE` path to submitted answers; the absence of an INSERT policy on
`admins`; the participant-code sequence and both its triggers; the signup
trigger on `auth.users`; and `security_invoker` on the admin views. It ends with
a single overall verdict.

It was validated by sabotage: RLS was disabled, a policy dropped, `anon` granted
table and function access, `UPDATE` granted on answers, an INSERT policy added
to `admins`, triggers dropped, a column dropped, a table dropped and a view
recreated without `security_invoker` — each was caught and named.

### How the schema itself was verified

`supabase/schema.sql` was executed against a real PostgreSQL 16 server and the
following were confirmed by test, each as the calling user with RLS active:

- a learner sees only their own participant row, attendance, answers and feedback
- a learner querying an admin view gets **zero** rows, not their own row
- a learner cannot enumerate the `admins` table or insert themselves into it
- a learner cannot change their own `participant_code` (the update silently
  restores it) while still being able to correct their own name
- a learner cannot update a submitted answer or delete their attendance
- an anonymous visitor can read the timetable and is refused everything else
- a check-in, test or feedback submission outside an open window is refused
- a second submission of the same component is refused
- a non-administrator calling `admin_publish_config` is refused
- certificate eligibility is computed by the database, not supplied by the client
- an anonymous caller is refused `record_attendance`, `submit_test` and
  `submit_feedback` at the privilege level, while retaining `component_is_open`
- the participant-code and signup triggers still fire after `EXECUTE` is revoked
  from every role (PostgreSQL does not check `EXECUTE` when firing a trigger)

To re-run these checks you need a PostgreSQL server and a small stub providing
`auth.users` and `auth.uid()`; the portal's own logic is covered separately and
with no setup by `node tools/selftest.js`.

## Known limitations — please read before using this with real data

**A learner can see the answer key.** The questions and their correct answers
are in `content/questions.csv`, which the browser downloads. Anyone who opens
the developer tools can read it. **This portal is suitable for formative
pre/post knowledge testing. It is not suitable for a high-stakes exam.** If you
need a secure exam, the scoring has to happen on a server that never sends the
key to the client — that is a different tool.

**A learner could submit a falsified score.** Scoring happens in the browser,
so a determined person could send a score that does not match their answers.
The raw responses are stored and the exports recompute every score from them,
so your analysis is unaffected — but the score shown in the admin table for
that person could be wrong. Treat `docs/EXPORTS.md`-derived scores as
authoritative and the live table as indicative.

**Timing data is indicative.** `*_duration_seconds` measures wall-clock time
between opening the form and submitting it, in the browser. It cannot tell the
difference between thinking and making a cup of tea.

**A misconfiguration is reported, not guessed at.** The portal refuses to start
on an invalid configuration and names the file and setting to change; a wrong
Supabase URL, a wrong key, or a database with no schema installed is diagnosed
specifically rather than surfacing as a blank page. Pasting the `service_role`
key into `config.js` is detected and refused before the page renders. This is
covered by regression tests in `tools/selftest.js`.

**Demo mode is not secure.** It stores everything unencrypted in one browser
profile with no privilege boundary — the first account is simply given the
admin console. It exists to let you try the tool. Never put real data in it.

**Account deletion is manual.** If a participant withdraws, you delete them in
the Supabase dashboard (**Authentication → Users**); their portal rows are
removed with them by cascade. There is no self-service deletion button, so
build this into whatever you tell participants about withdrawal.

**Anonymity is not the same as de-identification.** The research export carries
no direct identifiers, but a small course with detailed demographics can still
be re-identifiable — a single participant of a given role, affiliation and age
band may be unique. Review your `registrationFields` with that in mind, and
consider dropping or banding a field before sharing the file widely.

## Reporting a problem

Open an issue describing what you can do that you should not be able to. Please
do not include real participant data, and never include a `service_role` key.
