# Setting up the Course Portal

Written for someone who does not write code. You will not need to install
anything, use a terminal, or edit any program. You will edit two small text
files and copy-and-paste one block of SQL.

**Time needed:** about 40 minutes the first time.

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

Demo data lives only in that one browser. It is not shared, not backed up, and
not private. **Never put real participant data in demo mode.**

### Real mode (the rest of this guide)

For an actual course with real participants, follow Parts 1–9.

---

## Part 1 — Create the Supabase project

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

## Part 2 — Create the database tables

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

## Part 3 — Turn ON email confirmation

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

## Part 4 — Copy your project keys

1. Left sidebar → **Project Settings** (the gear) → **API Keys**
   (on some projects: **Data API**).
2. You need two values:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon** / **publishable** key — a long string of letters
3. In this repository, make a copy of `config.sample.js` and name the
   copy **`config.js`** (same folder as `index.html`).
4. Open `config.js` in a text editor and paste your two values in place of the
   placeholders. Save.

> ⚠️ There is also a **service_role** / **secret** key on that page.
> **Never** put it in `config.js`. It bypasses every security rule in the
> database. The `anon` key is designed to be public and is the correct one.

> `config.js` is deliberately excluded from version control (it is listed in
> `.gitignore`) so you cannot commit your keys by accident.

---

## Part 5 — Add the Supabase library

The portal needs one library file, which you save once so the portal never has
to call anyone else's server.

1. Download this file:
   **https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js**
   (open the link, then File → Save Page As)
2. Save it as **`vendor/supabase.js`** inside this repository.

See `vendor/README.md` for why this is worth doing rather than linking a CDN.

---

## Part 6 — Describe your course

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

## Part 7 — Write your questions

Open **`content/questions.csv`** and **`content/feedback.csv`** in Excel,
LibreOffice or Google Sheets. Replace the example rows with your own.
`content/README.md` explains every column.

The short version:

- `phase` = `both` puts a question in **both** tests. This is what makes a
  pre-versus-post comparison possible — use it for your scored questions.
- `answer_key` = the correct option's letter (`A`, `B`, `C`…). Leave it empty
  for questions you want to collect but not score.
- **Save as CSV (UTF-8)**, not as .xlsx.

Then check your file before the course, not during it:

```
node tools/selftest.js
```

It reads your real configuration and content and reports any problem in plain
English. If you do not have Node installed, just open the portal in demo mode
— it shows the same errors on screen.

---

## Part 8 — Put the files online

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

## Part 9 — Make yourself the administrator

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

Still stuck? Open an issue on the repository with the exact message you see.
Do not paste your `anon` key, and never paste your `service_role` key.
