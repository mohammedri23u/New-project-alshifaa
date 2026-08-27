# Troubleshooting

The ten problems people actually hit, in rough order of how often they happen.

**Two things to try before anything else:**

1. **Run `tools/verify-setup.sql`** — paste it into the Supabase SQL editor. It
   checks the whole database in one go and names what is wrong.
2. **Read the error card.** When the portal refuses to start it lists the exact
   file and setting to change. It is not a generic "something went wrong".

---

## 1. The yellow DEMO MODE banner is showing on my live site

**What it means:** the portal found no usable Supabase credentials, so it is
storing everything in the visitor's own browser. Nothing is being saved to your
database. Every visitor sees an empty portal and becomes their own administrator.

**Fix:**

- Is `config.js` actually in what you uploaded? It is deliberately excluded from
  version control (`.gitignore`), so it is easy to leave behind. Check the
  deployed site for it directly: open `https://your-site/config.js` in a browser.
  A 404 means it is not there.
- Does it still contain `YOUR-PROJECT-REF`? Then it was copied from
  `config.sample.js` but never edited. SETUP.md Part 4.
- Netlify Drop and similar tools sometimes skip hidden or unfamiliar files —
  re-upload the whole folder.

---

## 2. Participants never receive the confirmation email

**By far the most common problem on the day.**

**What it means:** Supabase's built-in mailer is a development convenience,
rate-limited to a handful of messages per hour. It is not built to send sixty
confirmations in ten minutes.

**Fix:** configure your own SMTP *before* the course:
**Project Settings → Authentication → SMTP Settings → Enable Custom SMTP**.
Use your institution's mail server (ask IT for host, port, username, password)
or a free tier of Resend, Brevo, Mailgun or SendGrid. SETUP.md Part 3.

**On the day, as a stopgap:** you can confirm an individual by hand in
**Authentication → Users** — open the user and confirm their address. This does
not scale past a handful of people.

**What not to do:** turning email confirmation off "just for today" means
anyone can register with anyone else's address, and your data can no longer be
attributed to a known person. If you do it anyway, turn it back on afterwards
and be prepared to say so in your methods.

---

## 3. "It says the pre-test is open, but submitting says it is closed"

**What it means:** the browser and the database disagree. The pages read the
times from `course.config.js`; the database enforces the times that were last
**published** to it.

**Fix:** Admin tab → **Publish schedule to server**. Do this every single time
you change a time in `course.config.js`. Confirm with `verify-setup.sql`:
row 19 should read `PASS`.

*This is not the timezone bug.* Times are converted with the same timezone name
in the browser and in the database, so they agree by construction — but only
once the schedule has been published.

---

## 4. The Admin tab does not appear

**Fix, in order:**

1. Did the SQL actually match an account? Run it again and look at the result:
   `INSERT 0 1` means it worked, `INSERT 0 0` means no account with that address
   exists yet. You must **register and confirm** first, then grant admin.
2. **Sign out and back in.** Administrator status is checked when a session is
   created, so an existing session will not pick it up.
3. Check it stuck: `select email from public.admins;`
4. Check the address matches exactly — `You@Example.org` and `you@example.org`
   may be different rows in `auth.users`.

There is deliberately no way to become an administrator from inside the app.

---

## 5. "The course content files could not be loaded"

**What it means:** the portal could not read `content/questions.csv` or
`content/feedback.csv`.

**Fix:**

- **Did you open `index.html` by double-clicking it?** That is the usual cause.
  Browsers block pages loaded from a `file://` address from reading local files.
  Serve the folder over HTTP: `python3 -m http.server 8000`, then open
  <http://localhost:8000>. SETUP.md Part 0.
- Otherwise the file is missing or renamed. Filenames are **case-sensitive** on
  most web hosts: `Questions.csv` will not be found when the config says
  `questions.csv`.
- Check the paths in `course.config.js` (`questionsFile`, `feedbackFile`) match
  where the files actually are, relative to `index.html`.

---

## 6. "Configuration problem", with a list

**What it means:** exactly what the list says. The portal refuses to start
rather than run a course that cannot work.

The ones that surprise people:

| Message contains | What is really wrong |
|---|---|
| `nobody can ever qualify` | Your certificate rule cannot be met. Either `minAttendanceDays` is larger than the number of days, or it requires a component with no configured window. |
| `not a valid IANA timezone name` | You used an offset such as `+03`, or misspelled the zone. Use `Africa/Cairo`, `Europe/London`, `America/New_York`. |
| `is not in YYYY-MM-DDTHH:mm form` | You added a `Z` or a `+03:00`, or wrote the date in another order. Write plain local wall-clock time: `2026-09-07T09:30`. |
| `no windows.attendance_3 entry` | You added a day but not its check-in window. |
| `refers to day 3, but days only has 2 entries` | The mirror image: you removed a day but left its window. |
| `used more than once` | Two rows in `questions.csv` share an `item_id`. Each must be unique — it becomes a column name in the exports. |
| `no scored question appears in BOTH tests` | Nothing is marked `phase: both` with an `answer_key`, so there would be no pre/post comparison at all. |

---

## 7. "Could not reach your Supabase project"

**Fix, in order:**

1. **Check `SUPABASE_URL` character by character** against
   **Project Settings → API Keys → Project URL**. One wrong letter in the project
   reference gives exactly this error, because the address simply does not exist.
2. **Is the project paused?** Free Supabase projects pause after a period of
   inactivity — a course portal set up weeks in advance is a classic case. Open
   the dashboard and resume it.
3. Are you offline, or behind a firewall that blocks `supabase.co`?

If instead you see **"did not answer within 15 seconds"**, the address is a real
website but not a Supabase API endpoint — you have probably pasted the dashboard
URL, or a URL with a path on the end, rather than the Project URL.

---

## 8. "Your Supabase project answered, but the portal's tables are not there"

**What it means:** the credentials work, but `schema.sql` has not been run in
*that* project.

**Fix:** SETUP.md Part 2, then run `tools/verify-setup.sql` to confirm. If you
are sure you ran it, check you ran it in the same project the URL points at —
having a test project and a real project open in two tabs is how this happens.

---

## 9. A participant says their records have vanished

Almost always: they have **two accounts**. They registered once, did not confirm,
registered again with a slightly different address, and their check-in is on the
other one.

**Fix:**

1. Ask them for the participant code on their screen.
2. Look it up in the operations export — it gives you the email address that
   code belongs to.
3. Check **Authentication → Users** for a second, similar address.
4. Decide which account is the real one. If work is split across two, the honest
   options are to ask them to redo the missing part on the surviving account, or
   to note the split in your records. **Do not** try to merge the rows by hand:
   participant codes are immutable by design, and editing them around that
   design is how linkage errors get into published data.

To prevent it: tell people to use their institutional address, and to check
their spam folder rather than registering again.

---

## 10. A participant's score looks wrong

**First, re-export.** The `*_correct` columns and all `cmp_*` figures are
recomputed from the raw stored responses and your current `answer_key` every
time you export. If you fixed a wrong answer key in `questions.csv` after the
course, a fresh export is correctly scored without anyone resitting anything.

**If a single person's score is implausible:** scoring happens in the browser,
so a determined participant could submit a score that does not match their
answers. The raw responses are stored either way, so the export is unaffected —
compare their `pre_Q01`…`post_Qnn` columns against the answer key and use the
recomputed `cmp_*` figures, which is what the exports already do.

**If everyone's score looks wrong:** check `answer_key` in `questions.csv`. A
column shifted by one in a spreadsheet does this. `node tools/selftest.js`
catches a key that matches no option, but not a key that points at the wrong
valid option.

---

## Still stuck

Open an issue with:

- what you did, what you expected, what happened
- the full output of `tools/verify-setup.sql`
- the exact text of any error card
- whether the demo banner is showing

**Never paste your `service_role` key.** The `anon` key is designed to be public,
but there is rarely any reason to include it either. Never include real
participant data.
