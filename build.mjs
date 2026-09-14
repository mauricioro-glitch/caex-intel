/**
 * CAEX Intelligence — gerador de páginas
 *
 * Lê os dados do Supabase e escreve arquivos HTML prontos dentro de ./public.
 * Roda no servidor de build da Cloudflare, nunca no navegador do visitante.
 *
 * Precisa de duas variáveis de ambiente, configuradas no painel da Cloudflare:
 *   SUPABASE_URL          https://pvovmrgfbhuasgleyqpw.supabase.co
 *   SUPABASE_SERVICE_KEY  a chave secreta (service_role)
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SITE = "https://intel.caex.earth";
const OUT = "public";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("\nFaltam as variáveis SUPABASE_URL e SUPABASE_SERVICE_KEY.");
  console.error("Configure em Cloudflare > Settings > Variables and Secrets.\n");
  process.exit(1);
}

/* ---------------------------------------------------------------
   Leitura do banco
   PostgREST devolve no máximo 1000 linhas por vez, então paginamos.
   --------------------------------------------------------------- */

async function fetchAll(table, columns) {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url =
      `${SUPABASE_URL}/rest/v1/${table}` +
      `?select=${encodeURIComponent(columns)}` +
      `&limit=${pageSize}&offset=${offset}`;

    const response = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Falha ao ler ${table} (HTTP ${response.status}): ${await response.text()}`
      );
    }

    const page = await response.json();
    rows.push(...page);
    process.stdout.write(`\r  ${table}: ${rows.length} linhas`);
    if (page.length < pageSize) break;
  }

  process.stdout.write("\n");
  return rows;
}

/* ---------------------------------------------------------------
   Normalização
   --------------------------------------------------------------- */

const slugify = (text) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// "AMS-I.D. (Version NA), AMS-III.G. (Version 4)" -> ["AMS-I.D.", "AMS-III.G."]
const splitMethodologies = (raw) =>
  (raw ?? "")
    .split(",")
    .map((part) => part.replace(/\s*\(Version[^)]*\)/gi, "").trim())
    .filter(Boolean);

const isIndexableStatus = (status) =>
  !!status && !/denied|rejected|withdrawn/i.test(status);

const num = (value) => Number(value) || 0;
const fmt = (value) => num(value).toLocaleString("en-US");

const esc = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* ---------------------------------------------------------------
   Componentes de página
   --------------------------------------------------------------- */

function layout({ title, description, canonical, jsonLd, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CAEX Intelligence">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/intel.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="masthead">
  <div class="shell masthead__inner">
    <a class="masthead__brand" href="/">
      <span class="masthead__name">CAEX</span>
      <span class="masthead__qualifier">Intelligence</span>
    </a>
    <nav class="masthead__links" aria-label="Site">
      <a href="/countries/">Countries</a>
      <a href="/#subscribe">Newsletter</a>
      <a href="https://caex.earth">Consulting</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="colophon">
  <div class="shell">
    <div class="colophon__grid">
      <div>
        <h2>CAEX Intelligence</h2>
        <p>Independent analysis of the voluntary carbon market, built on public registry data.</p>
      </div>
      <div>
        <h2>Browse</h2>
        <ul class="colophon__list">
          <li><a href="/countries/">All countries</a></li>
          <li><a href="/#subscribe">Weekly newsletter</a></li>
        </ul>
      </div>
      <div>
        <h2>Company</h2>
        <p>CAEX Consultoria Ltda<br>R. Pais Leme 215, cj 1713<br>Pinheiros, São Paulo-SP, Brazil</p>
      </div>
    </div>
    <div class="colophon__base">
      <span>&copy; 2026 CAEX Consultoria Ltda</span>
      <span>Source data: Verra registry, public records</span>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

function table(headings, rows) {
  if (!rows.length) return "";
  return `<div class="table-wrap"><table class="data">
<thead><tr>${headings.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody>
</table></div>`;
}

/* ---------------------------------------------------------------
   Página de país
   --------------------------------------------------------------- */

function countryPage(country, neighbours, totalCountries) {
  const {
    name, slug, projects, methodologies, retiredVcus, retirementCount,
    issuedVcus, topMethodologies, topProjects, topBuyers,
  } = country;

  const description =
    `${fmt(projects.length)} Verra carbon projects in ${name}, ` +
    `${fmt(retiredVcus)} credits retired across ${fmt(retirementCount)} transactions. ` +
    `Methodologies, leading projects and buyers.`;

  const body = `
<section class="lede lede--compact">
  <div class="shell">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> <span>/</span> <a href="/countries/">Countries</a> <span>/</span> <span>${esc(name)}</span>
    </nav>
    <h1 class="lede__title">Carbon projects in ${esc(name)}</h1>
    <p class="lede__standfirst">
      ${esc(name)} hosts ${fmt(projects.length)} carbon ${projects.length === 1 ? "project" : "projects"}
      registered with Verra, applying ${fmt(methodologies.size)}
      ${methodologies.size === 1 ? "methodology" : "different methodologies"}.
      ${retiredVcus > 0
        ? `${fmt(retiredVcus)} credits from these projects have been retired across ${fmt(retirementCount)} transactions.`
        : `No retirements from these projects appear in the registry yet.`}
    </p>
    <div class="ledger">
      <div class="ledger__cell"><span class="ledger__figure">${fmt(projects.length)}</span><span class="ledger__label">Projects</span></div>
      <div class="ledger__cell"><span class="ledger__figure">${fmt(methodologies.size)}</span><span class="ledger__label">Methodologies</span></div>
      <div class="ledger__cell"><span class="ledger__figure">${fmt(retiredVcus)}</span><span class="ledger__label">Credits retired</span></div>
      <div class="ledger__cell"><span class="ledger__figure">${fmt(issuedVcus)}</span><span class="ledger__label">Credits issued</span></div>
    </div>
  </div>
</section>

<section class="band band--surface">
  <div class="shell">
    <h2 class="band__title">Methodologies used in ${esc(name)}</h2>
    <p class="band__intro">Which accounting rules the projects in this country apply, by number of projects.</p>
    ${table(
      ["Methodology", "Projects"],
      topMethodologies.map(([code, count]) => [esc(code), fmt(count)])
    )}
  </div>
</section>

<section class="band band--paper">
  <div class="shell">
    <h2 class="band__title">Largest projects by expected annual volume</h2>
    ${table(
      ["Project", "Methodology", "Annual credits"],
      topProjects.map((p) => [
        esc(p.project_name ?? "Unnamed project"),
        esc(splitMethodologies(p.methodologies)[0] ?? "—"),
        fmt(p.avg_annual_vol_vcu),
      ])
    )}
  </div>
</section>

${topBuyers.length
      ? `<section class="band band--surface">
  <div class="shell">
    <h2 class="band__title">Identified buyers of ${esc(name)} credits</h2>
    <p class="band__intro">
      Most retirements in the Verra registry do not name a buyer. These are the organisations
      that did disclose one.
    </p>
    ${table(
        ["Organisation", "Credits retired", "Transactions"],
        topBuyers.map((b) => [esc(b.name), fmt(b.vcus), fmt(b.count)])
      )}
  </div>
</section>`
      : ""}

<section class="band band--paper">
  <div class="shell">
    <h2 class="band__title">Other countries</h2>
    <ul class="chips">
      ${neighbours
        .map((n) => `<li><a href="/country/${n.slug}/">${esc(n.name)}</a></li>`)
        .join("")}
      <li><a href="/countries/">All ${totalCountries} countries</a></li>
    </ul>
  </div>
</section>
`;

  return layout({
    title: `Carbon Projects in ${name} | Verra Registry Data | CAEX Intelligence`,
    description,
    canonical: `${SITE}/country/${slug}/`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Countries", item: `${SITE}/countries/` },
        { "@type": "ListItem", position: 3, name, item: `${SITE}/country/${slug}/` },
      ],
    },
    body,
  });
}

/* ---------------------------------------------------------------
   Índice de países
   --------------------------------------------------------------- */

function countriesIndexPage(countries) {
  const totalProjects = countries.reduce((sum, c) => sum + c.projects.length, 0);
  const totalRetired = countries.reduce((sum, c) => sum + c.retiredVcus, 0);

  const body = `
<section class="lede lede--compact">
  <div class="shell">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> <span>/</span> <span>Countries</span>
    </nav>
    <h1 class="lede__title">Carbon projects by country</h1>
    <p class="lede__standfirst">
      ${fmt(totalProjects)} Verra projects across ${fmt(countries.length)} host countries,
      with ${fmt(totalRetired)} credits retired to date.
    </p>
  </div>
</section>

<section class="band band--surface">
  <div class="shell">
    ${table(
      ["Country", "Projects", "Methodologies", "Credits retired"],
      countries.map((c) => [
        `<a href="/country/${c.slug}/">${esc(c.name)}</a>`,
        fmt(c.projects.length),
        fmt(c.methodologies.size),
        fmt(c.retiredVcus),
      ])
    )}
  </div>
</section>
`;

  return layout({
    title: "Carbon Projects by Country | Verra Registry Data | CAEX Intelligence",
    description: `Verra carbon projects across ${countries.length} countries: project counts, methodologies and credits retired for each.`,
    canonical: `${SITE}/countries/`,
    body,
  });
}

/* ---------------------------------------------------------------
   Sitemap
   --------------------------------------------------------------- */

function sitemap(paths) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
    .map(
      (p) => `  <url>
    <loc>${SITE}${p.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    )
    .join("\n")}
</urlset>
`;
}

/* ---------------------------------------------------------------
   Escrita em disco
   --------------------------------------------------------------- */

async function write(relativePath, contents) {
  const full = join(OUT, relativePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

/* ---------------------------------------------------------------
   Execução
   --------------------------------------------------------------- */

async function main() {
  console.log("\nLendo o banco de dados…");

  const [projects, retirements, issuances] = await Promise.all([
    fetchAll("projects", "project_id,project_name,status,country,methodologies,sectoral_scope,avg_annual_vol_vcu"),
    fetchAll("retirements", "project_id,quantity,beneficial_owner,country,methodology"),
    fetchAll("issuances", "project_id,quantity,country"),
  ]);

  const indexable = projects.filter((p) => isIndexableStatus(p.status));
  console.log(
    `\nProjetos: ${projects.length} no total, ${indexable.length} indexáveis ` +
    `(${projects.length - indexable.length} rejeitados ou retirados).`
  );

  // Diagnóstico de metodologias e escopos, já normalizados.
  const allMethodologies = new Set();
  const allScopes = new Set();
  for (const p of indexable) {
    for (const m of splitMethodologies(p.methodologies)) allMethodologies.add(m);
    for (const s of (p.sectoral_scope ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      allScopes.add(s);
    }
  }
  console.log(`Metodologias reais: ${allMethodologies.size}`);
  console.log(`Escopos setoriais reais: ${allScopes.size}`);

  // Agrupa por país.
  const byCountry = new Map();
  const ensure = (name) => {
    if (!byCountry.has(name)) {
      byCountry.set(name, {
        name,
        slug: slugify(name),
        projects: [],
        methodologies: new Set(),
        retiredVcus: 0,
        retirementCount: 0,
        issuedVcus: 0,
        buyers: new Map(),
      });
    }
    return byCountry.get(name);
  };

  const projectCountry = new Map();
  for (const p of indexable) {
    if (!p.country || !p.country.trim()) continue;
    const c = ensure(p.country.trim());
    c.projects.push(p);
    projectCountry.set(p.project_id, c);
    for (const m of splitMethodologies(p.methodologies)) c.methodologies.add(m);
  }

  for (const r of retirements) {
    const c = projectCountry.get(r.project_id) ?? (r.country ? byCountry.get(r.country.trim()) : null);
    if (!c) continue;
    c.retiredVcus += num(r.quantity);
    c.retirementCount += 1;

    const owner = (r.beneficial_owner ?? "").trim();
    if (owner) {
      const entry = c.buyers.get(owner) ?? { name: owner, vcus: 0, count: 0 };
      entry.vcus += num(r.quantity);
      entry.count += 1;
      c.buyers.set(owner, entry);
    }
  }

  for (const i of issuances) {
    const c = projectCountry.get(i.project_id) ?? (i.country ? byCountry.get(i.country.trim()) : null);
    if (c) c.issuedVcus += num(i.quantity);
  }

  // Ordena e prepara os recortes de cada página.
  const countries = [...byCountry.values()].sort(
    (a, b) => b.projects.length - a.projects.length
  );

  for (const c of countries) {
    const counts = new Map();
    for (const p of c.projects) {
      for (const m of splitMethodologies(p.methodologies)) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    c.topMethodologies = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    c.topProjects = [...c.projects]
      .sort((a, b) => num(b.avg_annual_vol_vcu) - num(a.avg_annual_vol_vcu))
      .slice(0, 20);

    c.topBuyers = [...c.buyers.values()]
      .sort((a, b) => b.vcus - a.vcus)
      .slice(0, 15);
  }

  // Escreve as páginas.
  const biggest = countries.slice(0, 12);
  const urls = [
    { path: "/", freq: "weekly", priority: "1.0" },
    { path: "/countries/", freq: "weekly", priority: "0.9" },
  ];

  for (const c of countries) {
    const neighbours = biggest.filter((n) => n.slug !== c.slug).slice(0, 10);
    await write(`country/${c.slug}/index.html`, countryPage(c, neighbours, countries.length));
    urls.push({ path: `/country/${c.slug}/`, freq: "monthly", priority: "0.7" });
  }

  await write("countries/index.html", countriesIndexPage(countries));
  await write("sitemap.xml", sitemap(urls));

  console.log(`\nGeradas ${countries.length} páginas de país.`);
  console.log(`Sitemap com ${urls.length} endereços.`);
  console.log("Pronto.\n");
}

main().catch((error) => {
  console.error("\nO build falhou:", error.message, "\n");
  process.exit(1);
});
