# Exports and the column dictionary

The admin console produces two files. They are deliberately separate, and the
separation is the point of the tool.

|  | Research export | Operations export |
|---|---|---|
| Who is it for | analysis, sharing, publication | course administration |
| Names, emails, phone numbers | **never** | yes |
| Item-level answers | yes, every one | **no** |
| Linking key | `participant_code` | `participant_code` |
| Typical use | "did scores improve?" | "who still has not done the feedback?" |

Both are **wide**: exactly one row per participant, one column per variable,
ready to open directly in R, Stata, SPSS, Python or Excel with no reshaping.

Alongside each file you can download a **column dictionary** — a CSV listing
every column, its type and a plain-English description. The dictionary is
generated from your own `course.config.js` and `content/*.csv`, so it always
matches the data file it came with. Keep the two together.

## The design rule

> The research file can be shared with a statistician, a co-author, a
> supervisor or a journal without any further de-identification step.
> The operations file cannot leave the course team.

To act on a research finding — say, CP-0042 has an implausible response —
an administrator looks that code up in the operations file. The research file
never has to hold a name for that to work.

A guard runs before every research download: if any column that could carry a
direct identifier ever appeared in that file, the download is **refused** with
an error rather than produced. Fields you mark as `identifier: true` in
`registrationFields` are included in that check.

## Column groups in the research export

| Prefix | What it holds |
|---|---|
| `participant_code` | The linkage key |
| `reg_*` | Registration answers that are not identifiers |
| `att_day1`, `att_day1_at`, … | Attendance per day: a 0/1 flag and a timestamp |
| `pre_*`, `post_*` (scores) | Submission time, raw score, maximum, percentage, duration |
| `cmp_*` | The pre-versus-post comparison, computed on the common items only |
| `pre_Q01`, `post_Q01`, … | The response to each item |
| `pre_Q01_correct`, … | 1/0 correctness for each scored item |
| `fb_F01`, `fb_F01_scored` | Feedback: the raw answer, and the reverse-corrected value |
| `certificate_*` | Eligibility and what is still outstanding |

### Three things worth knowing before you analyse

**1. `cmp_*` uses only the questions that appeared in both tests.**
`pre_score_percent` and `post_score_percent` cover each test in full — and if
your two tests do not contain identical scored items, comparing them directly
is wrong. `cmp_pre_percent` and `cmp_post_percent` are restricted to the items
marked `phase: both`, which is the honest comparison. Use the `cmp_*` columns
for any pre/post claim.

**2. `matched_pre_post` is your analysis sample.**
It is 1 only when the learner submitted both tests. Filter on it before any
paired test. `attendance_days` and `certificate_eligible` let you describe how
the matched sample differs from everyone else — which is worth reporting,
because it usually does.

**3. `fb_*_scored` is the column to average, not `fb_*`.**
For a reverse-worded item, `fb_F04` is what the learner clicked and
`fb_F04_scored` is `6 − that`, so that 5 always means the favourable direction.
Every Likert item has a `_scored` twin, including the ones that are not
reversed, so you can average the `_scored` columns without checking which is which.

### Conventions

- Timestamps are **ISO 8601 in UTC** (`2026-09-07T06:30:00.000Z`). They are
  absolute instants; convert to your course timezone if you want local times.
- Booleans are **1/0**, never `TRUE`/`yes`, so they load as numbers everywhere.
- Empty means **not applicable or not submitted** — for example, every
  `post_*` column is empty for someone who never sat the post-test. It does
  not mean zero.
- Files are UTF-8 with a byte-order mark, so Excel opens non-Latin text
  correctly.
- A value beginning `=`, `+`, `-` or `@` is prefixed with an apostrophe so a
  spreadsheet shows it as text instead of running it as a formula.

## Correctness is recomputed, not trusted

The database also stores an `is_correct` flag sent by the browser. **The
exports ignore it.** Every `*_correct` column and every `cmp_*` figure is
recomputed at export time from the raw stored response and the answer key in
`content/questions.csv`.

This matters twice over: a learner who tampered with what their browser sent
cannot change any reported result, and if you correct a wrong answer key after
the course, re-exporting gives you correctly scored data without touching the
stored responses.

## Reproducing a published result

The research export plus `content/questions.csv` is enough to recompute every
score in the file. Archive the two together, along with `course.config.js`,
and someone else can reproduce your numbers exactly — the scoring is plain
arithmetic with no randomness, no model and no service call.
