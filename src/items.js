/* ============================================================================
 * src/items.js — turn the editable CSV files into validated item objects.
 *
 * Nothing about the questions is hard-coded anywhere in this portal. This
 * module is the single place where content/*.csv becomes something the rest
 * of the code can use, and the single place where content errors are caught.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var CSV = (global.CP && global.CP.CSV) ||
            (typeof require === 'function' ? require('./csv.js') : null);

  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var LIKERT_SCALE = [
    { value: 1, key: 'likert1' }, { value: 2, key: 'likert2' },
    { value: 3, key: 'likert3' }, { value: 4, key: 'likert4' },
    { value: 5, key: 'likert5' }
  ];

  function truthy(v) { return /^(true|yes|y|1)$/i.test(String(v || '').trim()); }

  /**
   * Normalise one CSV row into an item.
   * Returns { item, errors: [] } — errors are reported, never thrown, so the
   * admin sees every problem in the file at once rather than one at a time.
   */
  function normaliseRow(row, index) {
    var errors = [];
    var id = String(row.item_id || '').trim();
    var where = 'row ' + (index + 2); // +2: 1-based, plus the header line

    if (!id) errors.push(where + ': item_id is empty');
    if (!/^[A-Za-z0-9_]+$/.test(id)) {
      errors.push(where + ': item_id "' + id + '" may contain only letters, digits and underscores' +
                  ' (it becomes a column name in the exports)');
    }

    var type = String(row.type || '').trim().toLowerCase();
    if (['mcq', 'likert', 'text'].indexOf(type) === -1) {
      errors.push(where + ' (' + id + '): type must be mcq, likert or text — got "' + type + '"');
    }

    var stem = String(row.stem || '').trim();
    if (!stem) errors.push(where + ' (' + id + '): stem is empty');

    var phase = String(row.phase || '').trim().toLowerCase() || 'both';
    if (['pre', 'post', 'both', 'feedback'].indexOf(phase) === -1) {
      errors.push(where + ' (' + id + '): phase must be pre, post, both or feedback — got "' + phase + '"');
    }

    var options = [];
    var rawOptions = String(row.options || '').trim();
    if (type === 'mcq') {
      if (!rawOptions) {
        errors.push(where + ' (' + id + '): an mcq item needs options separated by |');
      } else {
        options = rawOptions.split('|').map(function (t, i) {
          return { letter: LETTERS[i], text: t.trim() };
        }).filter(function (o) { return o.text !== ''; });
        if (options.length < 2) errors.push(where + ' (' + id + '): an mcq item needs at least 2 options');
      }
    }

    // The answer key may be given as a letter (B) or as the exact option text.
    var answerKey = null;
    var rawKey = String(row.answer_key || '').trim();
    if (rawKey && type === 'mcq') {
      var byLetter = options.filter(function (o) { return o.letter === rawKey.toUpperCase(); });
      var byText = options.filter(function (o) { return o.text.toLowerCase() === rawKey.toLowerCase(); });
      if (byLetter.length === 1) answerKey = byLetter[0].letter;
      else if (byText.length === 1) answerKey = byText[0].letter;
      else errors.push(where + ' (' + id + '): answer_key "' + rawKey + '" does not match any option');
    } else if (rawKey && type !== 'mcq') {
      errors.push(where + ' (' + id + '): only mcq items may have an answer_key');
    }

    var points = row.points === '' || row.points === undefined ? 1 : Number(row.points);
    if (isNaN(points) || points < 0) {
      errors.push(where + ' (' + id + '): points must be a number of 0 or more');
      points = 0;
    }

    var scored = type === 'mcq' && answerKey !== null && points > 0;

    return {
      errors: errors,
      item: {
        id: id,
        type: type,
        stem: stem,
        options: options,
        answerKey: answerKey,
        answerText: answerKey ? (options.filter(function (o) { return o.letter === answerKey; })[0] || {}).text : null,
        reverseScored: truthy(row.reverse_scored),
        phase: phase,
        points: points,
        scored: scored
      }
    };
  }

  /**
   * Load an item bank from CSV text.
   * @returns { items, errors, byId, forPhase(phase) }
   */
  function loadBank(csvText, sourceName) {
    var rows = CSV.parseObjects(csvText);
    var items = [], errors = [], seen = Object.create(null);

    if (rows.length === 0) errors.push((sourceName || 'file') + ': no rows found');

    rows.forEach(function (row, i) {
      var r = normaliseRow(row, i);
      errors = errors.concat(r.errors.map(function (e) { return (sourceName || 'file') + ' ' + e; }));
      if (seen[r.item.id]) {
        errors.push((sourceName || 'file') + ': item_id "' + r.item.id + '" is used more than once');
      }
      seen[r.item.id] = true;
      items.push(r.item);
    });

    var byId = Object.create(null);
    items.forEach(function (it) { byId[it.id] = it; });

    return {
      items: items,
      errors: errors,
      byId: byId,
      /** Items shown in a given phase. 'both' items appear in pre and post. */
      forPhase: function (phase) {
        return items.filter(function (it) {
          return it.phase === phase || (it.phase === 'both' && (phase === 'pre' || phase === 'post'));
        });
      },
      /** Scored items present in BOTH tests — the only fair pre/post comparison. */
      comparableItems: function () {
        return items.filter(function (it) { return it.phase === 'both' && it.scored; });
      }
    };
  }

  var Items = {
    loadBank: loadBank,
    normaliseRow: normaliseRow,
    LETTERS: LETTERS,
    LIKERT_SCALE: LIKERT_SCALE
  };

  global.CP = global.CP || {};
  global.CP.Items = Items;
  if (typeof module !== 'undefined' && module.exports) module.exports = Items;
})(typeof globalThis !== 'undefined' ? globalThis : this);
