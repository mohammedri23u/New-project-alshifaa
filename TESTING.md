# Dry run: testing on a throwaway Supabase project

Do this **once**, on a project you are willing to delete, before you invite a
single real participant. It takes about 45 minutes and it is the difference
between finding a problem now and finding it in front of a room of people.

You need two email addresses you can actually read (a personal one and any
second one — most mail providers let you add `+test` before the `@`, e.g.
`you+learner@example.com`, and it arrives in the same inbox).

---

## Before you start

- [ ] A **throwaway** Supabase project, created by following SETUP.md Parts 1–2.
      Name it something like `course-portal-test` so you never confuse it with
      the real one.
- [ ] The portal deployed and reachable at a URL (SETUP.md Part 8), or running
      locally with `python3 -m http.server 8000`.
- [ ] Both email addresses to hand.

> **Delete this project when you are done.** Do not promote a test project to
> production: it will contain test participants, holding codes RDM-0001 onward,
> and your real participants would start at RDM-0004.

---

## Part A — The database installed correctly

### A1. Run the verifier

Supabase → **SQL Editor** → **New query** → paste all of `tools/verify-setup.sql`
→ **Run**.

**Proves it worked:** a table of about 21 rows. Every row reads `PASS` except
rows 19 and 20, which read `WARN`, and the final `── OVERALL ──` row reads
`WARN` with "Schema is correct."

**Most likely failure:** rows 1–3 say `FAIL — MISSING: …`. You have not run
`supabase/schema.sql`, or it errored partway. Re-run it (SETUP.md Part 2) and
watch for a red error message.

> If row 4 ever says `RLS IS OFF ON: …`, **stop**. Participant data would be
> readable by anyone with the portal URL. Re-run `schema.sql` and check again.

### A2. Confirm email confirmation is on

**Authentication → Sign In / Providers → Email**.

**Proves it worked:** **Confirm email** is switched **ON**.

**Most likely failure:** it is off because you turned it off during an earlier
experiment. Turn it back on now — the next step tests it.

---

## Part B — Registration and the participant code

### B1. Register as a learner

Open the portal in a **private/incognito window** (so you can be a learner and
an administrator at once without signing in and out). Register with your
*second* address.

**Proves it worked:** the page says a confirmation link has been sent to that
address.

**Most likely failure:** the yellow **DEMO MODE** banner is showing. Then you are
not testing the real thing at all — `config.js` is missing from what you
uploaded, or still contains the placeholder values (SETUP.md Part 4).

### B2. Password rules are enforced

Before completing B1, try a password of `abc` and then two passwords that do
not match.

**Proves it worked:** you get "Password must be at least 10 characters." and
"The two passwords do not match." and the form does not submit.

### B3. Confirm the email

Open the confirmation link.

**Proves it worked:** you land back on the portal and can sign in.

**Most likely failure:** *no email arrives.* This is the single most common
problem. Supabase's built-in mailer is rate-limited to a handful of messages
per hour and is meant only for development. Check the spam folder, then set up
your own SMTP (SETUP.md Part 3) before the real course — with sixty people
registering at once, most of them would get nothing.

### B4. An unconfirmed account cannot sign in

Register a *third* address and, without opening its confirmation link, try to
sign in.

**Proves it worked:** "Your email address has not been confirmed yet."

**Most likely failure:** you get straight in. Confirmation is off — go back to A2.

### B5. The participant code appears

Sign in as the learner from B1.

**Proves it worked:** a card shows a code like `CP-0001`, and there is nowhere
on the page to type or choose one.

**Most likely failure:** the page loads but no code card appears, or you are
bounced back to sign-in. The `on_auth_user_created` trigger did not fire —
check row 16 of the verifier from A1.

---

## Part C — Becoming an administrator

### C1. Grant yourself admin

In your **normal** browser window, register with your *first* address and confirm
it. Then run in the SQL editor, with that address:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

**Proves it worked:** `INSERT 0 1`. Reload the portal — an **Admin** tab appears.

**Most likely failure:** `INSERT 0 0` — no user with that address exists yet, so
you have not registered and confirmed it. Or the tab does not appear: sign out
and back in, because admin status is read at sign-in.

### C2. A learner is not an administrator

Look at the incognito window (the learner from B1).

**Proves it worked:** there is **no** Admin tab.

> If a learner *does* see the Admin tab, stop and re-run the verifier. Row 12
> must pass.

### C3. Publish the schedule

Admin tab → **Publish schedule to server**.

**Proves it worked:** "Schedule published." Re-run `verify-setup.sql`: row 19
now reads `PASS` with a count of windows.

**Most likely failure:** "Administrators only" — C1 did not take effect.

---

## Part D — Attendance

### D1. A closed day refuses a check-in

As the learner, look at the Day 1 card while its window has not opened.

**Proves it worked:** the card shows "Not open yet. Opens …" and offers **no**
check-in button.

### D2. Force open, then check in

Admin tab → the `attendance_1` row → **Force open**. Reload the learner window.

**Proves it worked:** Day 1 now offers **Check in**. Click it: the card turns to
"Checked in at …".

**Most likely failure:** clicking gives "Attendance for day 1 is not open."
The browser and the database disagree — you changed the times in
`course.config.js` but did not press **Publish schedule to server** (C3).

### D3. Checking in twice does nothing bad

Reload and look again.

**Proves it worked:** the card still shows one check-in time, and the button is
gone. There is no second row.

### D4. Repeat for the remaining days

Force open each remaining day and check in, until you have met the
`minAttendanceDays` in your certificate rule.

---

## Part E — The tests

### E1. Pre-test refuses an incomplete submission

Admin: **Force open** the `pre` row. As the learner, start the pre-test and
press Submit with nothing answered.

**Proves it worked:** "Please answer every required question. *n* still
unanswered." Free-text questions are always optional and are not counted.

### E2. Submit the pre-test — deliberately get some wrong

Answer every question, getting **at least one** multiple-choice question wrong
on purpose. You need this to see a change later. Submit and confirm.

**Proves it worked:** you return to the home page and see "Your pre-test has
been recorded. Scores are shown after the post-test." **No score is revealed** —
that is deliberate, so the pre-test does not teach the answers.

**Most likely failure:** "The pre is not open." — the window closed between
opening the form and submitting, or the schedule was never published.

### E3. The pre-test cannot be taken twice

**Proves it worked:** the Pre-test card no longer offers **Start**.

### E4. Post-test

Admin: **Force open** the `post` row. As the learner, sit the post-test, this
time answering **everything correctly**.

### E5. The results report

**Proves it worked:** immediately after submitting you see three tiles — a
pre-test percentage, a higher post-test percentage, and a positive change — then
a question-by-question review showing your pre answer, your post answer and the
correct answer, with the item you fixed marked as newly correct.

**Most likely failure:** the report says it is based on 0 questions. No scored
item is marked `phase: both` in your `questions.csv`, so there is nothing to
compare. The portal now refuses to start in that state, so you would have seen
an error card earlier.

---

## Part F — Feedback and eligibility

### F1. Feedback

Admin: **Force open** `feedback`. As the learner, complete and submit it.

**Proves it worked:** "Submitted. Thank you." and the card no longer offers
**Start**.

### F2. Certificate eligibility

Learner → **My status**.

**Proves it worked:** a green panel, "You meet all requirements for a
certificate", and a checklist with every line ticked.

**Most likely failure:** it stays grey and lists what is outstanding — read the
list, it is telling you exactly which component or how many days are missing.
If it lists something you *have* done, the component was recorded against a
different account: check you are signed in as the same learner.

### F3. A partly-finished learner is not eligible

Register a second learner (your third address from B4, once confirmed), check
in for one day only, and stop.

**Proves it worked:** their status page is grey and lists the missing items.

---

## Part G — The exports

### G1. Download both

Admin tab → **Research export (no identifiers)** and **Operations export
(identifiers)**.

**Proves it worked:** two CSV files download, each with one row per participant.

### G2. **Check the research file yourself — do not take this on trust**

Open the research file in a spreadsheet and search it for:

- [ ] each participant's **name** — must not appear
- [ ] each participant's **email address** — must not appear
- [ ] any field you marked `identifier: true` — must not appear
- [ ] the participant codes — **must** appear

**Proves it worked:** the first three searches find nothing, the fourth finds
every code.

> This is the check that matters most. If a name ever appears in the research
> file, stop using the tool and open an issue.

### G3. The operations file is the mirror image

**Proves it worked:** names and email addresses **are** there, `participant_code`
is there, and there are **no** per-question answer columns.

### G4. The numbers are right

Find your own row in the research file.

**Proves it worked:**
- [ ] `attendance_days` matches how many days you checked in
- [ ] `pre_score_percent` is lower than `post_score_percent`
- [ ] `cmp_items_gained` is at least 1 (the question you fixed)
- [ ] `matched_pre_post` is `1`
- [ ] `certificate_eligible` is `1` for you and `0` for the partial learner
- [ ] `certificate_outstanding` is empty for you and lists items for them

### G5. Download a column dictionary

Click **Column dictionary (research)**.

**Proves it worked:** a CSV describing every column in the file you just
downloaded. Keep the two together.

---

## Part H — Close the course down

### H1. Force everything closed

Admin: set every row to **Force closed**.

**Proves it worked:** the learner window shows no action buttons anywhere, and
every card reads as closed.

### H2. A closed window really is closed

While a component is force-closed, have the learner reload and try to reach it.

**Proves it worked:** no button is offered. (The database refuses the write too,
even if a request were crafted by hand — that is tested separately and does not
need checking here.)

---

## Part I — Clean up

- [ ] Delete the throwaway Supabase project (**Project Settings → General →
      Delete project**), *or*
- [ ] Delete every test user (**Authentication → Users** → select → **Delete
      user**) — their portal rows go with them — and note that participant codes
      will continue from where the test left off.

Then set up your **real** project from scratch with SETUP.md.

---

## If any step fails, what to check first

Work down this list. Nine times in ten it is one of the first four.

1. **Is the yellow DEMO MODE banner showing?**
   Then nothing you are testing is real. `config.js` is missing from the upload
   or still has placeholder values. SETUP.md Part 4.

2. **Did you press "Publish schedule to server" after changing any time?**
   The browser reads `course.config.js`; the database enforces what was
   published. Every "it says it's open but the server disagrees" problem is
   this. SETUP.md Part 9, step 5.

3. **Run `tools/verify-setup.sql`.**
   It checks the whole database in one paste and names what is wrong. Do this
   before investigating anything in the portal itself.

4. **Are you signed in as who you think you are?**
   Two windows, two accounts. Almost every "my check-in vanished" turns out to
   be a check-in recorded against the other account. The participant code on
   screen tells you which one you are.

5. **Sign out and back in.**
   Administrator status is read at sign-in, so a freshly granted admin needs a
   new session.

6. **Read the error card.**
   The portal refuses to start on a bad configuration and lists the exact
   setting to change, file by file. It is not a generic message.

7. **Open the browser console** (F12 → Console) and reload.
   One 404 for `config.js` is expected in demo mode. Anything else — especially
   a red CORS or network error — points at the Supabase URL.

8. **Check the Supabase project is awake.**
   Free projects pause after inactivity. Open the dashboard and resume it.

9. **Emails not arriving?** That is the built-in mailer's rate limit, not a
   portal fault. SETUP.md Part 3, "The sending limit that catches people out".

10. **Still stuck?** Open an issue with: the step number from this document,
    what you expected, what happened, and the output of `verify-setup.sql`.
    Never paste your `service_role` key; the `anon` key is safe to share but
    there is rarely a reason to.
