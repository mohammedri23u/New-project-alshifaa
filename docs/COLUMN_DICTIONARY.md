# Column dictionary

Every column in both exports: what it is called, what type it holds, what its
values mean, and how it is derived.

**This page describes the columns produced by the configuration shipped in this
repository.** Your own deployment will have different `reg_*`, `pre_*`, `post_*`
and `fb_*` columns, because those are generated from *your*
`course.config.js` and *your* `content/*.csv`. Everything else is the same in
every deployment.

> You do not have to keep this page in step by hand. The admin console has a
> **Column dictionary** button next to each export, which generates the same
> table from your own configuration at the moment you download the data. Keep
> that file with your data — it is the authoritative description of *your*
> columns. This page explains what the columns mean in general.

## Conventions used throughout

| Convention | Meaning |
|---|---|
| `0/1` | Boolean written as a number, so it loads as numeric in every package. `1` = yes. |
| Empty cell | **Not applicable or not submitted** — never zero. Every `post_*` column is empty for someone who never sat the post-test. |
| `datetime (ISO 8601, UTC)` | An absolute instant, e.g. `2026-09-07T06:30:00.000Z`. Convert to your course timezone if you want local times. |
| `number (0-100)` | A percentage, not a proportion. `80` means 80%. |
| Encoding | UTF-8 with a byte-order mark, so Excel reads non-Latin text correctly. |
| Leading apostrophe | A value starting `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheets show it as text instead of running it as a formula. |

## How derived values are computed

| Column group | Derivation |
|---|---|
| `*_correct` | **Recomputed at export time** from the stored raw response and the `answer_key` in `content/questions.csv`. The `is_correct` flag the browser sent is stored but ignored, so a tampered submission cannot change a reported result. |
| `cmp_*` | Computed over **only** the scored items marked `phase: both` — the items that appear in both tests. This is the only defensible pre/post comparison. |
| `cmp_normalised_gain` | Hake's *g* = (post − pre) / (100 − pre), on the common items. Empty when the pre-test was already 100%, where *g* is undefined. |
| `fb_*_scored` | For a `reverse_scored` item, `6 − raw`; otherwise identical to the raw answer. Average **these**, not the raw `fb_*` columns. |
| `certificate_eligible` | Evaluated by the database view `v_progress` against the rule in `course.config.js`. Demo mode computes the same rule locally. |
| `attendance_days` | Count of days with a check-in row. A check-in cannot be edited or back-dated once made. |

---

## Research export

No names, no email addresses, no phone numbers, and no registration field
marked `identifier: true`. A guard refuses the download outright if any
identifier column would ever appear.

| Column | Type | Meaning |
|---|---|---|
| `participant_code` | string | Server-generated immutable code. The linkage key: every row of every instrument for one learner carries this value. Never chosen or typed by the learner. |
| `registered_at` | datetime (ISO 8601, UTC) | When the learner completed registration. |
| `reg_affiliation` | string | Registration field: Affiliation |
| `reg_role` | string | Registration field: Current role (one of: Student; Trainee; Practitioner; Educator; Researcher; Other) |
| `reg_years_exp` | number | Registration field: Years of experience |
| `reg_gender` | string | Registration field: Gender (one of: Female; Male; Prefer not to say) |
| `att_day1` | 0/1 | Checked in on day 1 (Day 1 — Foundations). 1 = present. |
| `att_day2` | 0/1 | Checked in on day 2 (Day 2 — Core Methods). 1 = present. |
| `att_day3` | 0/1 | Checked in on day 3 (Day 3 — Applications). 1 = present. |
| `att_day1_at` | datetime (ISO 8601, UTC) | Check-in timestamp for day 1. Empty if absent. |
| `att_day2_at` | datetime (ISO 8601, UTC) | Check-in timestamp for day 2. Empty if absent. |
| `att_day3_at` | datetime (ISO 8601, UTC) | Check-in timestamp for day 3. Empty if absent. |
| `attendance_days` | integer | Number of days checked in, out of 3. |
| `pre_submitted` | 0/1 | Pre-test submitted. |
| `pre_submitted_at` | datetime (ISO 8601, UTC) | When the pre-test was submitted. |
| `pre_score_raw` | number | Pre-test points scored (all scored items in that test). |
| `pre_score_max` | number | Pre-test points available. |
| `pre_score_percent` | number (0-100) | Pre-test score as a percentage. |
| `pre_duration_seconds` | integer | Seconds between opening and submitting the pre-test. Empty if not recorded. |
| `post_submitted` | 0/1 | Post-test submitted. |
| `post_submitted_at` | datetime (ISO 8601, UTC) | When the post-test was submitted. |
| `post_score_raw` | number | Post-test points scored (all scored items in that test). |
| `post_score_max` | number | Post-test points available. |
| `post_score_percent` | number (0-100) | Post-test score as a percentage. |
| `post_duration_seconds` | integer | Seconds between opening and submitting the post-test. Empty if not recorded. |
| `matched_pre_post` | 0/1 | Learner submitted BOTH tests, so this row can be used in a paired pre/post analysis. |
| `cmp_n_items` | integer | Number of scored items present in both tests — the basis of the columns below. |
| `cmp_pre_percent` | number (0-100) | Pre-test score on the common items only. |
| `cmp_post_percent` | number (0-100) | Post-test score on the common items only. |
| `cmp_change_points` | number | cmp_post_percent minus cmp_pre_percent, in percentage points. |
| `cmp_normalised_gain` | number | Hake's normalised gain: (post-pre)/(100-pre). Empty when the pre-test was already 100%. |
| `cmp_items_gained` | integer | Common items wrong before and right after. |
| `cmp_items_lost` | integer | Common items right before and wrong after. |
| `cmp_items_kept` | integer | Common items right both times. |
| `cmp_items_unchanged` | integer | Common items wrong both times. |
| `pre_Q01` | string (option letter) | Pre-test response to Q01: Which of the following best describes the purpose of a pre-test in a short course? |
| `pre_Q01_correct` | 0/1 | Pre-test response to Q01 was correct (key: B). |
| `pre_Q02` | string (option letter) | Pre-test response to Q02: A study reports that 40 of 200 participants completed all components. What is the completion rate? |
| `pre_Q02_correct` | 0/1 | Pre-test response to Q02 was correct (key: B). |
| `pre_Q03` | string (option letter) | Pre-test response to Q03: Which identifier is most appropriate for linking a learner's records across several instruments while protecting privacy? |
| `pre_Q03_correct` | 0/1 | Pre-test response to Q03 was correct (key: C). |
| `pre_Q04` | string (option letter) | Pre-test response to Q04: If a measurement is repeated under identical conditions and gives the same answer each time, it is described as: |
| `pre_Q04_correct` | 0/1 | Pre-test response to Q04 was correct (key: B). |
| `pre_Q05` | string (option letter) | Pre-test response to Q05: The main advantage of collecting responses electronically rather than on paper is: |
| `pre_Q05_correct` | 0/1 | Pre-test response to Q05 was correct (key: C). |
| `pre_Q06` | string | Pre-test response to Q06: In one or two sentences, describe one thing you hope to learn from this course. |
| `post_Q01` | string (option letter) | Post-test response to Q01: Which of the following best describes the purpose of a pre-test in a short course? |
| `post_Q01_correct` | 0/1 | Post-test response to Q01 was correct (key: B). |
| `post_Q02` | string (option letter) | Post-test response to Q02: A study reports that 40 of 200 participants completed all components. What is the completion rate? |
| `post_Q02_correct` | 0/1 | Post-test response to Q02 was correct (key: B). |
| `post_Q03` | string (option letter) | Post-test response to Q03: Which identifier is most appropriate for linking a learner's records across several instruments while protecting privacy? |
| `post_Q03_correct` | 0/1 | Post-test response to Q03 was correct (key: C). |
| `post_Q04` | string (option letter) | Post-test response to Q04: If a measurement is repeated under identical conditions and gives the same answer each time, it is described as: |
| `post_Q04_correct` | 0/1 | Post-test response to Q04 was correct (key: B). |
| `post_Q05` | string (option letter) | Post-test response to Q05: The main advantage of collecting responses electronically rather than on paper is: |
| `post_Q05_correct` | 0/1 | Post-test response to Q05 was correct (key: C). |
| `post_Q07` | string | Post-test response to Q07: In one or two sentences, describe one thing you will do differently as a result of this course. |
| `feedback_submitted` | 0/1 | Feedback form submitted. |
| `feedback_submitted_at` | datetime (ISO 8601, UTC) | When feedback was submitted. |
| `fb_F01` | integer 1-5 | Feedback (as answered, 1=strongly disagree, 5=strongly agree): The course objectives were clearly explained. |
| `fb_F01_scored` | integer 1-5 | Same as fb_F01 (this item is not reverse-scored). Provided so all fb_*_scored columns can be averaged directly. |
| `fb_F02` | integer 1-5 | Feedback (as answered, 1=strongly disagree, 5=strongly agree): The content was relevant to my work or studies. |
| `fb_F02_scored` | integer 1-5 | Same as fb_F02 (this item is not reverse-scored). Provided so all fb_*_scored columns can be averaged directly. |
| `fb_F03` | integer 1-5 | Feedback (as answered, 1=strongly disagree, 5=strongly agree): The pace of the course was appropriate. |
| `fb_F03_scored` | integer 1-5 | Same as fb_F03 (this item is not reverse-scored). Provided so all fb_*_scored columns can be averaged directly. |
| `fb_F04` | integer 1-5 | Feedback (as answered, 1=strongly disagree, 5=strongly agree): I found it difficult to follow the material. |
| `fb_F04_scored` | integer 1-5 | Same item after REVERSE scoring (6 minus the raw value), so that 5 always means the favourable direction. |
| `fb_F05` | integer 1-5 | Feedback (as answered, 1=strongly disagree, 5=strongly agree): I would recommend this course to a colleague. |
| `fb_F05_scored` | integer 1-5 | Same as fb_F05 (this item is not reverse-scored). Provided so all fb_*_scored columns can be averaged directly. |
| `fb_F06` | string | Feedback response: How did you hear about this course? |
| `fb_F07` | string | Feedback response: What was the most useful part of the course? |
| `fb_F08` | string | Feedback response: What single change would most improve the course? |
| `fb_likert_mean` | number 1-5 | Mean of all reverse-corrected Likert feedback items answered by this learner. |
| `fb_likert_n` | integer | How many Likert items that mean is based on. |
| `certificate_eligible` | 0/1 | Eligibility computed from the configured rule. In a Supabase deployment this value is computed by the server, not the browser. |
| `certificate_outstanding` | string | Semicolon-separated list of unmet requirements. Empty when eligible. |
| `completed_all_components` | 0/1 | Registration, pre-test, post-test and feedback all submitted, regardless of attendance. |

---

## Operations export

For course administration. Contains direct identifiers, and **no item-level
answers** — staff chasing a missing form never need to see how someone answered
a question.

| Column | Type | Meaning |
|---|---|---|
| `participant_code` | string | The same code used in the research export, and the only LINKING column between the two files. It lets an administrator act on a research finding without the research file ever holding a name. (The two files also share some non-identifying summary columns such as attendance counts; they share no direct identifier.) |
| `full_name` | string | DIRECT IDENTIFIER. Name as entered at registration. |
| `email` | string | DIRECT IDENTIFIER. Login address; also where the learner would be contacted. |
| `reg_phone` | string | DIRECT IDENTIFIER. Registration field: Mobile number |
| `reg_affiliation` | string | Registration field: Affiliation |
| `reg_role` | string | Registration field: Current role |
| `reg_years_exp` | number | Registration field: Years of experience |
| `reg_gender` | string | Registration field: Gender |
| `registered_at` | datetime (ISO 8601, UTC) | When the learner registered. |
| `att_day1` | 0/1 | Checked in on day 1 (Day 1 — Foundations). |
| `att_day2` | 0/1 | Checked in on day 2 (Day 2 — Core Methods). |
| `att_day3` | 0/1 | Checked in on day 3 (Day 3 — Applications). |
| `attendance_days` | integer | Days checked in, out of 3. |
| `pre_done` | 0/1 | Pre-test submitted. |
| `post_done` | 0/1 | Post-test submitted. |
| `feedback_done` | 0/1 | Feedback submitted. |
| `post_score_percent` | number (0-100) | Post-test percentage — included because some certificate rules depend on it. |
| `certificate_eligible` | 0/1 | Meets the configured certificate rule. |
| `certificate_outstanding` | string | What is still missing, semicolon-separated. This is the column to use when chasing people up. |

---

## Choosing your analysis sample

Three columns decide who is in it:

- **`matched_pre_post`** — 1 only when the learner submitted both tests. Filter
  on this before any paired analysis.
- **`attendance_days`** and **`certificate_eligible`** — describe how the matched
  sample differs from everyone else. It usually does differ, and saying so is
  worth a sentence in your methods.
- **`completed_all_components`** — registration, both tests and feedback, ignoring
  attendance.

A worked example, in R:

```r
d <- read.csv("short-course_research_2026-09-12.csv", fileEncoding = "UTF-8-BOM")

# Who can be analysed as a pair?
table(d$matched_pre_post)

paired <- subset(d, matched_pre_post == 1)
t.test(paired$cmp_post_percent, paired$cmp_pre_percent, paired = TRUE)

# Did the people who completed both tests attend more than those who did not?
t.test(attendance_days ~ matched_pre_post, data = d)

# Mean feedback across the reverse-corrected Likert items
mean(d$fb_likert_mean, na.rm = TRUE)
```

## Re-identification: a caution

The research export carries no direct identifiers, but that is not the same as
anonymity. In a course of thirty people, one participant of a given role,
affiliation and experience band may well be unique. Before sharing the file
outside your team, look at your `reg_*` columns and consider dropping or
banding any that are unusually specific. This is a judgement about *your*
cohort that no tool can make for you.
