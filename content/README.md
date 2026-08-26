# Editable content files

Both files are plain CSV. Edit them in Excel, LibreOffice, Google Sheets or a
text editor, save as CSV (UTF-8), and reload the portal. **No code changes are
needed to change your questions.**

- `questions.csv` — the pre-test and post-test items
- `feedback.csv` — the end-of-course feedback items

## Column specification

| Column | Required | Meaning |
|---|---|---|
| `item_id` | yes | Short unique code, e.g. `Q01`. **This becomes the column name in the exports, so do not renumber items after data collection has started.** |
| `type` | yes | `mcq`, `likert` or `text` |
| `stem` | yes | The question text shown to the learner |
| `options` | for `mcq` | Answer choices separated by a pipe `\|`. Leave empty for `likert` and `text`. |
| `answer_key` | for scored `mcq` | The correct option as a letter (`A`, `B`, `C`, …) or the exact option text. Leave empty for unscored items. |
| `reverse_scored` | no | `TRUE` for negatively-worded `likert` items — the portal reverses them (1↔5, 2↔4) before averaging |
| `phase` | yes | `pre`, `post`, `both`, or `feedback` |
| `points` | no | Points for a correct answer (default `1`). Use `0` for unscored items. |

## Rules the portal enforces

- An `mcq` with a non-empty `answer_key` is **scored**; one without is collected but not scored.
- `likert` items are always presented on a fixed 1–5 agreement scale
  (Strongly disagree → Strongly agree) and are never scored as right/wrong.
- `text` items are free text; they are exported verbatim and never scored.
- `phase: both` puts the same item in **both** the pre-test and the post-test —
  this is what makes a pre/post comparison possible. Use it for your scored items.
- Items with `phase: pre` appear only in the pre-test; `phase: post` only in the post-test.
  These are **not** included in the pre-vs-post score comparison, because there is
  nothing to compare them with.

## Quoting

If your question text contains a comma, wrap the whole field in double quotes:

```csv
Q09,mcq,"Which of these, if any, is a rate?","A count|A proportion per unit time",B,,both,1
```

To include a literal double quote inside a quoted field, double it: `""`.
