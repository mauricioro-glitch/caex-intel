# CAEX Intelligence

Static site published at https://intel.caex.earth

## How it works

`build.mjs` reads the Supabase database and writes HTML files into `public/`.
Cloudflare runs it on every push to `main`, then publishes `public/`.

No data is fetched in the visitor's browser. Every page is a finished file.

## Required settings in Cloudflare

Settings > Variables and Secrets:

    SUPABASE_URL          https://pvovmrgfbhuasgleyqpw.supabase.co
    SUPABASE_SERVICE_KEY  the service_role key (secret)

Settings > Build configuration:

    Build command    npm install && node build.mjs
    Deploy command   npx wrangler deploy
    Version command  (leave empty)

## Structure

    build.mjs               page generator
    wrangler.jsonc          Cloudflare publishing config
    public/                 what goes live
      index.html            homepage (hand-written)
      404.html              not-found page
      robots.txt
      assets/css/intel.css  shared stylesheet
      assets/images/        logo and favicon

Generated at build time and not committed: `public/country/`,
`public/countries/`, `public/sitemap.xml`.

## Newsletter

The signup form writes to `newsletter_subscribers` using the publishable key.
That key is safe in public code: row level security permits inserts only.
