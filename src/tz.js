/* ============================================================================
 * src/tz.js — timezone-correct conversion between wall-clock time and instants.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A naive portal compares `new Date()` (the *browser's* clock, in whatever
 * timezone the learner's laptop happens to be set to) against a deadline that
 * the database interprets in the *course's* timezone. A learner travelling, or
 * simply with a misconfigured device, then sees a window as open that the
 * server rejects — or misses a window that is actually open.
 *
 * Everything here works in terms of INSTANTS (milliseconds since the epoch).
 * A configured wall-clock string such as "2026-09-07T09:30" is converted to an
 * instant *using the course timezone*, exactly as PostgreSQL does with
 *     ('2026-09-07T09:30'::timestamp AT TIME ZONE 'Africa/Cairo')
 * so the browser and the database always agree, daylight saving included.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PART_CACHE = Object.create(null);

  function formatter(tz) {
    if (!PART_CACHE[tz]) {
      PART_CACHE[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return PART_CACHE[tz];
  }

  /** The UTC offset, in milliseconds, that `tz` was using at instant `utcMs`. */
  function offsetMs(utcMs, tz) {
    var parts = formatter(tz).formatToParts(new Date(utcMs));
    var p = Object.create(null);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    // Some engines render midnight as hour "24"; normalise it.
    var hour = p.hour === '24' ? 0 : Number(p.hour);
    var asIfUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                           hour, Number(p.minute), Number(p.second));
    return asIfUTC - utcMs;
  }

  /**
   * Convert a wall-clock string in `tz` to an instant (ms).
   * Accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" and "YYYY-MM-DDTHH:mm:ss".
   * Returns NaN for anything unparseable, so callers can fail loudly.
   *
   * Two passes are needed because the offset itself depends on the instant we
   * are trying to find. The second pass settles any daylight-saving boundary.
   */
  function wallToInstant(wall, tz) {
    if (wall == null) return NaN;
    var s = String(wall).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (!m) return NaN;
    var naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var guess = naive - offsetMs(naive, tz);
    var refined = naive - offsetMs(guess, tz);
    return refined;
  }

  /** Human-readable rendering of an instant, in the course timezone. */
  function formatInstant(ms, tz, opts) {
    if (ms == null || isNaN(ms)) return '—';
    var o = opts || {};
    var fmt = new Intl.DateTimeFormat(o.locale || 'en-GB', {
      timeZone: tz,
      year: 'numeric', month: 'short', day: '2-digit',
      hour: o.dateOnly ? undefined : '2-digit',
      minute: o.dateOnly ? undefined : '2-digit',
      hour12: false
    });
    return fmt.format(new Date(ms));
  }

  /** ISO-8601 instant with a real offset — the form stored in the database. */
  function toISO(ms) {
    return (ms == null || isNaN(ms)) ? null : new Date(ms).toISOString();
  }

  /** "YYYY-MM-DD" for an instant, as seen in `tz`. */
  function dateKey(ms, tz) {
    var parts = formatter(tz).formatToParts(new Date(ms));
    var p = Object.create(null);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    return p.year + '-' + p.month + '-' + p.day;
  }

  /**
   * Resolve a component window to a state at instant `now`.
   *
   * @param win       {opensAt, closesAt} wall-clock strings, or null
   * @param tz        IANA timezone name
   * @param now       instant in ms
   * @param override  null | true | false — an administrator's manual override,
   *                  which takes precedence over the configured times.
   * @returns {state, opensMs, closesMs, reason}
   *          state is 'open' | 'before' | 'after' | 'closed' | 'unconfigured'
   */
  function windowState(win, tz, now, override) {
    var opensMs = win && win.opensAt ? wallToInstant(win.opensAt, tz) : null;
    var closesMs = win && win.closesAt ? wallToInstant(win.closesAt, tz) : null;

    if (override === true)  return { state: 'open',   opensMs: opensMs, closesMs: closesMs, reason: 'opened by administrator' };
    if (override === false) return { state: 'closed', opensMs: opensMs, closesMs: closesMs, reason: 'closed by administrator' };

    if (opensMs === null && closesMs === null)
      return { state: 'unconfigured', opensMs: null, closesMs: null, reason: 'no window configured' };
    if (isNaN(opensMs) || isNaN(closesMs))
      return { state: 'unconfigured', opensMs: opensMs, closesMs: closesMs, reason: 'window could not be parsed — check course.config.js' };

    if (opensMs !== null && now < opensMs)
      return { state: 'before', opensMs: opensMs, closesMs: closesMs, reason: 'not open yet' };
    if (closesMs !== null && now > closesMs)
      return { state: 'after', opensMs: opensMs, closesMs: closesMs, reason: 'window has closed' };
    return { state: 'open', opensMs: opensMs, closesMs: closesMs, reason: 'open' };
  }

  var TZ = {
    offsetMs: offsetMs,
    wallToInstant: wallToInstant,
    formatInstant: formatInstant,
    toISO: toISO,
    dateKey: dateKey,
    windowState: windowState
  };

  global.CP = global.CP || {};
  global.CP.TZ = TZ;
  if (typeof module !== 'undefined' && module.exports) module.exports = TZ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
