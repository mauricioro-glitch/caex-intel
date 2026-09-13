# CAEX Intelligence

Static site published at https://intel.caex.earth

## Structure

    public/                 everything that goes live
      index.html            homepage
      404.html              not-found page
      robots.txt            crawler instructions
      sitemap.xml           list of pages for Google
      assets/css/intel.css  shared stylesheet
      assets/images/        logo and favicon
    wrangler.jsonc          Cloudflare publishing config

## Publishing

Cloudflare watches the `main` branch. Any commit triggers `npx wrangler deploy`,
which uploads the contents of `public/`.

## Newsletter

The signup form writes to the `newsletter_subscribers` table in Supabase using the
publishable key. That key is safe in public code: row level security on the table
permits inserts only, never reads.
