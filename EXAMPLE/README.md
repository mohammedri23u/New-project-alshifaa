# A complete worked example

A real, deployable two-day course: **Introduction to Research Data Management**.
Six scored questions asked in both tests, two free-text reflections, and a
nine-item feedback form. Deploy it exactly as it is and everything works.

Use it to see the tool working before you write your own content, or as a
starting point to edit.

## Try it in one minute, with no server

From the project root:

```
cp EXAMPLE/course.config.js  course.config.js
cp EXAMPLE/questions.csv     content/questions.csv
cp EXAMPLE/feedback.csv      content/feedback.csv
python3 -m http.server 8000
```

Open <http://localhost:8000> and register. Because every window in this example
is open, you can go straight through: check in for both days, sit the pre-test,
sit the post-test, see the results report, leave feedback, and watch the
certificate panel turn green. The first account you create also gets the admin
console, so you can download both exports.

> Restore the defaults afterwards with `git checkout course.config.js content/`.

## What makes this a good example to copy

- **Six questions are marked `phase: both`.** That is what produces a pre/post
  comparison — the same six items asked twice. The two free-text items differ
  between the tests on purpose, and are excluded from the comparison because
  there is nothing to compare them with.
- **`FB04` is reverse-scored.** It is worded negatively ("I struggled to
  follow…"), so `reverse_scored` is `TRUE` and the portal flips it before
  averaging. The export gives you both the raw answer and the corrected one.
- **The certificate rule is demanding** (both days, both tests, feedback), so
  you can watch the eligibility list shrink as you complete each part.
- **`career_stage` and `has_dmp` are ordinary demographic fields** and appear in
  the research export. No field here is marked `identifier: true`, so nothing
  from registration is withheld from it. Add `identifier: true` to any field
  that could identify someone — a phone number, a staff number — and it will
  appear only in the operations export.

## Before you use it for a real course

1. **Narrow the windows.** Every window runs from 2026 to 2030 so the example
   works straight away. As written, a learner could sit the post-test before the
   course begins. Set your real dates in `windows` — the commented lines in
   `course.config.js` show the shape.
2. **Change the timezone** from `Europe/London` to yours.
3. **Change `participantCodePrefix`** from `RDM` to something meaningful to you.
4. **Replace the questions.** These are about research data management; yours
   will not be.
5. **Run `node tools/selftest.js`** to confirm your edits are coherent.
