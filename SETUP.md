# Setting up the Course Portal

Written for someone who does not write code. You will not need to install
anything or write a program. You will edit two small text files and
copy-and-paste one block of SQL.

## Before you start, you need

| | |
|---|---|
| **A Supabase account** | Free. Sign up at <https://supabase.com> with GitHub or an email address. This is the database and login system. |
| **About 60 minutes**, uninterrupted | 40 minutes of setup, plus 20 for the first run-through. Do not do this on the morning of the course. |
| **Somewhere to put the files** | Any free static host: Netlify Drop, Cloudflare Pages, GitHub Pages, or your institution's own web server. Netlify Drop needs no account and takes about a minute. |
| **A text editor** | Notepad, TextEdit (in plain-text mode), VS Code — anything that saves plain text. **Not** Word. |
| **Your course details** | Dates, day titles, and your questions. Have them written down before you start. |
| **Your institution's SMTP details** | Host, port, username, password — ask IT. Only needed for a real course, but get it early; it is the step that most often delays people. See Part 3. |

**Not needed:** a terminal, a programming language, a paid plan, or a server of
your own.

## How long each part takes

| Part | What | Time |
|---|---|---|
| 0 | Try it with no server at all | 5 min |
| 1 | Create the Supabase project | 5 min |
| 2 | Create the database tables | 5 min |
| 2b | **Check the database installed correctly** | 2 min |
| 3 | Turn on email confirmation, set up SMTP | 10 min |
| 4 | Copy your project keys | 5 min |
| 5 | Add the Supabase library | 3 min |
| 6 | Describe your course | 10 min |
| 7 | Write your questions | as long as it takes |
| 8 | Put the files online | 5 min |
| 9 | Make yourself the administrator | 5 min |

Then do a full dry run on a throwaway project — see **[TESTING.md](TESTING.md)**.

There are two routes. Read **Part 0** first and pick one.

---

## Part 0 — Do you even need a server?

### Demo mode (5 minutes, no account, no server)

The portal runs with no backend at all, storing everything in your own browser.
Use this to see what the tool does, to show a colleague, or to check your
questions before a real course.

1. Download this repository as a ZIP and unzip it.
2. You still need to open it through a small web server, because browsers
   refuse to read the `content/questions.csv` file from a plain `file://`
   address. If you have Python (already installed on macOS and most Linux):
   open the folder in a terminal and run

   ```
   python3 -m http.server 8000
   ```

   Then open **http://localhost:8000** in your browser.

   No terminal? Upload the folder to any free static host (Netlify Drop,
   GitHub Pages, Cloudflare Pages) — it works there straight away.
3. A yellow **DEMO MODE** banner confirms there is no server.
   The first account you register is automatically the administrator so you
   can explore the admin console.

**Want a course that is ready to click through?** The `EXAMPLE/` folder holds a
complete two-day course with every window already open, so you can go from
registration to certificate without touching the admin console:

```
cp EXAMPLE/course.config.js  course.config.js
cp EXAMPLE/questions.csv     content/questions.csv
cp EXAMPLE/feedback.csv      content/feedback.csv
```

See `EXAMPLE/README.md`. Undo it later with `git checkout course.config.js content/`.

Demo data lives only in that one browser. It is not shared, not backed up, and
not private. **Never put real participant data in demo mode.**

### Real mode (the rest of this guide)

For an actual course with real participants, follow Parts 1–9.

---

## Part 1 — Create the Supabase project *(5 minutes)*

Supabase provides the database and the login system. The free tier is enough
for a course of a few hundred people.

1. Go to **https://supabase.com** and click **Start your project**. Sign in
   with GitHub or an email address.
2. Click **New project**.
3. Fill in:
   - **Name** — anything, e.g. `course-portal`
   - **Database Password** — click **Generate a password** and save it in your
     password manager. You will probably never need it, but you cannot recover it.
   - **Region** — pick the one closest to your participants.
4. Click **Create new project** and wait 1–2 minutes for it to finish setting up.

---

## Part 2 — Create the database tables *(5 minutes)*

1. In the left sidebar click **SQL Editor**.
2. Click **New query** (top right).
3. Open the file `supabase/schema.sql` from this repository in any text editor.
   Select **all** of it (Ctrl-A / Cmd-A) and copy it.
4. Paste it into the big empty box in the SQL Editor.
5. Click **Run** (bottom right, or Ctrl-Enter).
6. You should see **Success. No rows returned**. That is what success looks
   like — the script creates things, it does not return a list.

If you see a red error, nothing was changed (the whole script runs as one
transaction). Copy the error message and check you pasted the entire file.

> Running this file a second time is safe. It will not delete data.

---

## Part 2b — Check the database installed correctly *(2 minutes)*

Do not skip this. It takes two minutes and it is the only way to know that all
of the security rules actually took effect.

1. **SQL Editor** → **New query** (again).
2. Open `tools/verify-setup.sql` from this repository, select all of it, copy it.
3. Paste it into the box and click **Run**.
4. You get a table of about 21 rows. Read the **result** column.

**What you should see on a fresh install:**

- every row `PASS`, except
- rows 19 and 20 `WARN` — "no schedule published yet" and "no administrator
  yet". Both are steps you have not done yet (Parts 9). That is expected.
- the last row, `── OVERALL ──`, reads `WARN` with "Schema is correct."

**If any row says `FAIL`**, the `detail` column tells you exactly what is wrong.
Usually it means `schema.sql` did not finish — go back to Part 2 and re-run it,
watching for a red error.

> **Row 4 is the important one.** If it ever says `RLS IS OFF ON: …`, stop.
> That means participant data would be readable by anyone with the portal
> address. Re-run `schema.sql` and check again before going any further.

This script only reads; it changes nothing. Run it again any time, including
during a live course.

---

## Part 3 — Turn ON email confirmation *(10 minutes)*

**Do this before anyone registers.** It is the setting that stops someone
signing up with an address that is not theirs.

1. Left sidebar → **Authentication** → **Sign In / Providers** (older projects:
   **Providers**).
2. Find **Email** and click it.
3. Make sure **Confirm email** is switched **ON**.
4. Click **Save**.

New Supabase projects have this on by default. Check it anyway.

**Only for testing:** you may switch **Confirm email** OFF so that test accounts
work instantly without a real mailbox. If you do, switch it back **ON** before
you send the link to real participants, and delete the test accounts
(**Authentication → Users**, tick them, **Delete user**).

### The sending limit that catches people out

Supabase's built-in mailer sends only a **small number of emails per hour** and
is meant for development. If 60 people register in the first ten minutes of your
course, most of them will not receive a confirmation email.

For any real course, set up your own SMTP:

1. **Project Settings → Authentication → SMTP Settings**.
2. Switch **Enable Custom SMTP** on.
3. Enter the details from your institution's mail server, or a free tier of
   Resend / Brevo / Mailgun / SendGrid.
4. Click **Save**.

Ask your IT department for the SMTP host, port, username and password. This is
the single most common reason a course portal "does not work" on the day.

---

## Part 4 — Copy your project keys *(5 minutes)*

1. Left sidebar → **Project Settings** (the gear icon at the bottom) →
   **API Keys**. On some projects this page is called **Data API**.
2. You need two values from that page:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`.
     There is a copy button beside it; use it rather than retyping.
   - The key labelled **anon** or **publishable** — a long string, hundreds of
     characters. Click **Reveal** if it is hidden, then the copy button.
3. In this repository, find `config.sample.js`. **Make a copy of it** (right-click
   → Copy, then Paste) and **rename the copy to `config.js`** — exactly that,
   in the same folder as `index.html`.
4. Open `config.js` in your text editor. You will see two lines with
   `YOUR-PROJECT-REF` and `YOUR-ANON-PUBLISHABLE-KEY` in them. Replace **only**
   the text between the quote marks with your two values, leaving the quotes and
   the semicolons alone. Save.

It should end up looking like this, with your own values:

```js
var APP_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.xxxxx'
};
```

If you paste the wrong key or a mistyped URL, the portal will tell you so in
plain English when you open it rather than failing silently — but it is quicker
to get it right now.

> ⚠️ There is also a **service_role** / **secret** key on that page.
> **Never** put it in `config.js`. It bypasses every security rule in the
> database. The `anon` key is designed to be public and is the correct one.

> `config.js` is deliberately excluded from version control (it is listed in
> `.gitignore`) so you cannot commit your keys by accident.

---

## Part 5 — Add the Supabase library *(3 minutes)*

The portal needs one library file, which you save once so the portal never has
to call anyone else's server.

1. Download this file:
   **https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js**
   (open the link, then File → Save Page As)
2. Save it as **`vendor/supabase.js`** inside this repository.

See `vendor/README.md` for why this is worth doing rather than linking a CDN.

---

## Part 6 — Describe your course *(10 minutes)*

Open **`course.config.js`** in a text editor. It is heavily commented. Change:

| Setting | What to put |
|---|---|
| `courseName`, `courseShortName`, `organisation`, `contactEmail` | Your course and institution |
| `language` | `'en'` or `'ar'` |
| `timezone` | Your course's timezone, e.g. `'Africa/Cairo'`, `'Asia/Riyadh'`, `'Europe/London'`. Must be a name from the [tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) — never `'+03'`. |
| `participantCodePrefix` | A short prefix for participant codes, e.g. `'EPI'` gives `EPI-0001` |
| `days` | One entry per course day, from 1 to 5 |
| `windows` | When each part opens and closes |
| `certificate` | What a learner must complete to qualify |
| `registrationFields` | Which demographic questions to ask |

### About the times

Write times as **`'YYYY-MM-DDTHH:mm'`** in your course's own local time.
Do not add `Z` or `+03:00`. For example, if your pre-test should close at
half past nine in the morning on 7 September:

```js
pre: { opensAt: '2026-09-01T00:00', closesAt: '2026-09-07T09:30' },
```

The portal converts this using your `timezone` setting, and so does the
database, so a participant whose laptop clock is set to the wrong country still
sees exactly the same deadline the server enforces.

Add one `attendance_N` window for each day in `days`. If the portal finds a day
without a window it refuses to start and tells you which one is missing.

---

## Part 7 — Write your questions *(as long as it takes)*

Open **`content/questions.csv`** and **`content/feedback.csv`** in Excel,
LibreOffice or Google Sheets. Replace the example rows with your own.
`content/README.md` explains every column.

The short version:

- `phase` = `both` puts a question in **both** tests. This is what makes a
  pre-versus-post comparison possible — use it for your scored questions.
- `answer_key` = the correct option's letter (`A`, `B`, `C`…). Leave it empty
  for questions you want to collect but not score.
- **Save as CSV (UTF-8)**, not as .xlsx.

`EXAMPLE/questions.csv` is a complete, working set of six scored questions and
two free-text ones — a good thing to copy and edit rather than starting from a
blank sheet.

Then check your file before the course, not during it. **You do not need any
tools for this:** open the portal in demo mode (Part 0) and it will either work
or show you a list of exactly what is wrong with your files, in plain English.

If you happen to have Node installed, this does the same checks from the command
line and is quicker to repeat:

```
node tools/selftest.js
```

---

## Part 8 — Put the files online *(5 minutes)*

Upload the whole folder to any static web host. All of these work and are free
for this size of site:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the folder
  onto the page. Done, you get a URL immediately.
- **Cloudflare Pages**, **GitHub Pages**, **Vercel** — connect the repository.
- Your institution's own web server — copy the folder into any web directory.

Make sure `config.js` and `vendor/supabase.js` are included in what you upload.

Open the URL. The yellow demo banner should be **gone**. If it is still there,
`config.js` is missing or still contains the placeholder text.

---

## Part 9 — Make yourself the administrator *(5 minutes)*

There is no way to become an administrator from inside the application. That is
deliberate: it means nobody can promote themselves.

1. Open your portal URL and **register yourself** like any participant.
2. Confirm your email address using the link you receive.
3. Go back to Supabase → **SQL Editor** → **New query** and run this, with your
   own address:

   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.org'
   on conflict (user_id) do nothing;
   ```

4. Reload the portal. An **Admin** tab now appears.
5. In the admin console, click **Publish schedule to server** — once.

   This copies the times from `course.config.js` into the database so that the
   database enforces exactly what the pages display. **Do this again any time
   you change the times in `course.config.js`.**

To add a colleague as an administrator, ask them to register, then run the same
SQL with their address.

---

## Running the course

**Before the course**
- Publish the schedule (Part 9, step 5).
- Send participants the portal URL. Tell them to register and to confirm the
  email. Nobody needs a participant code — the server issues one automatically.

**Each morning**
- Open the **Admin** tab. Attendance for that day opens automatically at the
  time you configured. If people arrive late, click **Force open** on that day
  and **Follow schedule** again afterwards.

**After the course**
- Once the post-test and feedback windows close, click **Force closed** on
  everything so nothing arrives late.
- Download both exports (see `docs/EXPORTS.md`).

---

## If something goes wrong

| What you see | What it usually means |
|---|---|
| Yellow **DEMO MODE** banner on the live site | `config.js` is missing, was not uploaded, or still has the placeholder values |
| **"Configuration problem"** with a list | Exactly what it says — fix the listed lines in `course.config.js` |
| **"The course content files could not be loaded"** | You opened `index.html` from your file manager instead of through a web address, or a CSV file was renamed |
| Participants never get a confirmation email | Supabase's built-in mailer is rate-limited. Set up SMTP (Part 3) |
| A learner says the pre-test "is closed" but you think it is open | You changed `course.config.js` but did not click **Publish schedule to server** |
| **"Administrators only"** | The `insert into public.admins` step has not been run for that account |
| Admin tab missing after you ran the SQL | Sign out and back in — administrator status is checked at sign-in |
| A learner registered with the wrong email | Delete them in **Authentication → Users** and ask them to register again. Their participant code is not reused. |

For more, see **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**, which
covers these in depth.

Still stuck? Open an issue on the repository with the exact message you see and
the output of `tools/verify-setup.sql`. Never paste your `service_role` key.

---

## Before your first real course

Do a full dry run on a **throwaway** Supabase project, following
**[TESTING.md](TESTING.md)**. It is a numbered checklist of every step from
registration to export, with what proves each one worked. It takes about 45
minutes and it is the difference between finding a problem now and finding it in
front of a room of people.
