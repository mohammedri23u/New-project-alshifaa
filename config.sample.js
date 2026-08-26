/* ============================================================================
 * config.sample.js  —  DEPLOYMENT CREDENTIALS TEMPLATE
 *
 *   1. Copy this file to  config.js   (same folder)
 *   2. Paste your own Supabase project URL and anon key into it
 *   3. NEVER commit config.js — it is listed in .gitignore
 *
 * If config.js is missing, or still contains the placeholder values below,
 * the portal starts in DEMO MODE (browser-only, no server). That is the
 * intended way to try the portal without creating a Supabase project.
 *
 * WHICH KEY GOES HERE:
 *   Use the **anon / publishable** key only. It is designed to be public and
 *   every table is protected by Row Level Security.
 *   NEVER put the **service_role / secret** key in this file. It bypasses all
 *   Row Level Security and would expose every participant's data to anyone who
 *   opens the page source.
 * ==========================================================================*/

var APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLISHABLE-KEY'
};

if (typeof globalThis !== 'undefined') globalThis.APP_CONFIG = APP_CONFIG;
