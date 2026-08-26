/* ============================================================================
 * src/csv.js — a small, dependency-free RFC-4180 CSV reader and writer.
 *
 * Used for two things:
 *   1. reading the editable content files (content/*.csv)
 *   2. writing the research and operations exports
 * ==========================================================================*/
(function (global) {
  'use strict';

  /**
   * Parse CSV text into an array of arrays.
   * Handles quoted fields, embedded commas, embedded newlines, doubled quotes
   * ("" for a literal quote), CRLF, and a UTF-8 byte-order mark.
   */
  function parseRows(text) {
    if (text == null) return [];
    var s = String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // strip BOM

    var rows = [], row = [], field = '', inQuotes = false, i = 0;

    while (i < s.length) {
      var c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    // Flush the final field/row unless the file ended with a clean newline.
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  /**
   * Parse CSV text into an array of objects keyed by the header row.
   * Blank lines are skipped. Values are trimmed.
   */
  function parseObjects(text) {
    var rows = parseRows(text).filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });
    if (rows.length === 0) return [];
    var header = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).map(function (r) {
      var o = Object.create(null);
      for (var i = 0; i < header.length; i++) {
        if (!header[i]) continue;
        o[header[i]] = r[i] === undefined ? '' : String(r[i]).trim();
      }
      return o;
    });
  }

  /** Quote one field for output. */
  function quote(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    // A leading =, +, - or @ can be executed as a formula by spreadsheet apps.
    // Prefix with a single quote so the value is shown literally instead.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * Serialise an array of objects to CSV text.
   * @param rows    array of plain objects
   * @param columns array of column keys, in order (required — export column
   *                order must be deterministic, never dependent on key order)
   */
  function toCSV(rows, columns) {
    var out = [columns.map(quote).join(',')];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var line = [];
      for (var j = 0; j < columns.length; j++) line.push(quote(r[columns[j]]));
      out.push(line.join(','));
    }
    // A UTF-8 BOM makes Excel open non-ASCII text (e.g. Arabic) correctly.
    return '﻿' + out.join('\r\n') + '\r\n';
  }

  var CSV = { parseRows: parseRows, parseObjects: parseObjects, toCSV: toCSV, quote: quote };

  global.CP = global.CP || {};
  global.CP.CSV = CSV;
  if (typeof module !== 'undefined' && module.exports) module.exports = CSV;
})(typeof globalThis !== 'undefined' ? globalThis : this);
