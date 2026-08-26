# vendor/

This folder holds one file, and only for deployments that use Supabase:

    vendor/supabase.js

**Demo mode does not need it.** The portal only requests this file once
`config.js` contains real Supabase credentials, so a demo deployment makes no
third-party requests at all.

## How to get it

Download the browser build of `@supabase/supabase-js` v2 once and save it here:

```
curl -L -o vendor/supabase.js \
  https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
```

Then commit it, or upload it alongside the rest of the files.

## Why vendor it instead of linking a CDN?

* The portal then makes **no requests to any third party** — nothing about
  your participants, not even their IP addresses, reaches anyone but your own
  Supabase project. That is much easier to justify to an ethics committee.
* The version you tested is the version that runs, forever.
* It keeps working if the CDN is blocked, rate-limited, or offline.
