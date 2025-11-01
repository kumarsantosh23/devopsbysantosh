const fs = require('fs').promises;
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const OUT = path.resolve(__dirname, '..', 'docs');

async function rimraf(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function copyRecursive(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const e of entries) {
      await copyRecursive(path.join(src, e), path.join(dest, e));
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

function rewriteHtmlContent(content) {
  content = content.replace(/(href|src)=["']\/([^"']+)["']/g, '$1="./$2"');
  content = content.replace(/(href|src)=["'](?:\.\.\/)?src\/([^"']+)["']/g, '$1="./$2"');
  content = content.replace(/(href|src)=["']\.\.\/([^"']+)["']/g, '$1="./$2"');
  return content;
}

async function rewriteHtmlFiles(dir) {
  const entries = await fs.readdir(dir);
  for (const e of entries) {
    const p = path.join(dir, e);
    const stat = await fs.stat(p);
    if (stat.isDirectory()) {
      await rewriteHtmlFiles(p);
    } else if (e.toLowerCase().endsWith('.html')) {
      let data = await fs.readFile(p, 'utf8');
      const newData = rewriteHtmlContent(data);
      if (newData !== data) await fs.writeFile(p, newData, 'utf8');
    }
  }
}

/**
 * Read src/data/projects.json (and optional repos.json) and inject generated
 * HTML into docs/projects.html replacing the placeholder <!--PROJECTS_PLACEHOLDER-->.
 * Resolves GitHub links from various project fields and from repos.json metadata.
 */
async function injectProjects() {
  const projectsJson = path.join(SRC, 'data', 'projects.json');
  const reposJson = path.join(SRC, 'data', 'repos.json');
  const targetHtml = path.join(OUT, 'projects.html');

  // ensure target exists
  try {
    await fs.access(targetHtml);
  } catch {
    return; // nothing to do if there's no projects.html in docs
  }

  let projects = [];
  try {
    const p = await fs.readFile(projectsJson, 'utf8');
    projects = JSON.parse(p);
    if (!Array.isArray(projects)) projects = [];
  } catch (err) {
    console.warn('No valid projects.json found, skipping injection.');
    return;
  }

  let repos = [];
  try {
    const r = await fs.readFile(reposJson, 'utf8');
    repos = JSON.parse(r);
    if (!Array.isArray(repos)) repos = [];
  } catch {
    repos = [];
  }

  // build lookups for repos.json
  const repoByName = {};   // simple repo name -> repo
  const repoByFull = {};   // owner/repo -> repo
  (repos || []).forEach(r => {
    if (!r) return;
    try {
      if (r.name) repoByName[String(r.name).toLowerCase()] = r;
      if (r.full_name) repoByFull[String(r.full_name).toLowerCase()] = r;
      if (r.html_url) {
        const u = new URL(r.html_url);
        const parts = u.pathname.replace(/^\/+|\/+$/g, '').toLowerCase(); // owner/repo
        if (parts) repoByFull[parts] = r;
      }
    } catch (e) {
      // ignore malformed entries
    }
  });

  const esc = (s = '') =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const normalizeRepoKey = (s = '') =>
    String(s || '').replace(/^git\+/, '').replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/,'').toLowerCase();

  const resolveHref = (p) => {
    if (!p) return null;

    // common explicit URL fields
    const urlCandidates = [
      p.url, p.homepage, p.website, p.link, p.html_url, p.repo_url, p.github_url
    ];
    for (const c of urlCandidates) {
      if (c && typeof c === 'string') {
        // return as-is if absolute, else treat repo-like strings below
        if (c.startsWith('http')) return c;
      }
    }

    // repository field (package.json style)
    if (p.repository) {
      if (typeof p.repository === 'string') {
        if (p.repository.includes('github.com')) return p.repository.replace(/^git\+/, '');
        if (p.repository.includes('/')) return `https://github.com/${p.repository.replace(/^git\+/, '')}`;
      } else if (p.repository && p.repository.url) {
        return p.repository.url.replace(/^git\+/, '');
      }
    }

    // github field: owner/repo | full url | name
    if (p.github && typeof p.github === 'string') {
      if (p.github.startsWith('http')) return p.github;
      if (p.github.includes('/')) return `https://github.com/${p.github}`;
      const byName = repoByName[p.github.toLowerCase()];
      if (byName && byName.html_url) return byName.html_url;
    }

    // repo field: string owner/repo or name or object
    if (p.repo) {
      if (typeof p.repo === 'string') {
        if (p.repo.startsWith('http')) return p.repo;
        if (p.repo.includes('/')) return `https://github.com/${p.repo}`;
        const byName = repoByName[p.repo.toLowerCase()];
        if (byName && byName.html_url) return byName.html_url;
      } else if (typeof p.repo === 'object') {
        if (p.repo.html_url) return p.repo.html_url;
        if (p.repo.full_name) return `https://github.com/${p.repo.full_name}`;
      }
    }

    // fallback: find matching repo by project name/title
    const nameKey = String(p.name || p.title || '').toLowerCase();
    if (nameKey && repoByName[nameKey] && repoByName[nameKey].html_url) return repoByName[nameKey].html_url;

    return null;
  };

  const listHtml = (projects || []).map(p => {
    const title = esc(p.title || p.name || 'Untitled');
    const desc = p.description ? `<p>${esc(p.description)}</p>` : '';
    const href = resolveHref(p) || null;

    // stars lookup
    let starsHtml = '';
    if (href && href.includes('github.com')) {
      const key = normalizeRepoKey(href);
      const repoMatch = repoByFull[key] || repoByName[key.split('/').pop()];
      if (repoMatch && typeof repoMatch.stargazers_count !== 'undefined') {
        starsHtml = ` <span class="stars">⭐ ${esc(String(repoMatch.stargazers_count))}</span>`;
      }
    }

    const link = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`;
    return `<li>${link}${starsHtml}${desc}</li>`;
  }).join('\n');

  try {
    let html = await fs.readFile(targetHtml, 'utf8');
    const placeholder = '<!--PROJECTS_PLACEHOLDER-->';
    if (html.includes(placeholder)) {
      html = html.replace(placeholder, `<ul>\n${listHtml}\n</ul>`);
      await fs.writeFile(targetHtml, html, 'utf8');
      console.log('Injected projects into docs/projects.html');
      return;
    }

    // support both container IDs used in your files
    if (html.includes('id="projects-list"') || html.includes('id="projects-container"')) {
      html = html.replace(/(<div[^>]*id=["']projects-list["'][^>]*>)([\s\S]*?)(<\/div>)/i, `$1\n<ul>\n${listHtml}\n</ul>\n$3`);
      html = html.replace(/(<div[^>]*id=["']projects-container["'][^>]*>)([\s\S]*?)(<\/div>)/i, `$1\n<ul>\n${listHtml}\n</ul>\n$3`);
      await fs.writeFile(targetHtml, html, 'utf8');
      console.log('Appended projects into projects container in docs/projects.html');
      return;
    }

    console.warn('No placeholder or projects container found in projects.html; skipping injection.');
  } catch (err) {
    console.error('Failed to inject projects:', err);
  }
}

async function build() {
  try {
    await fs.access(SRC);
  } catch (err) {
    console.error(`Source folder not found: ${SRC}`);
    process.exit(1);
  }

  console.log('Cleaning docs/ ...');
  await rimraf(OUT);
  console.log(`Copying ${SRC} → ${OUT} ...`);
  await copyRecursive(SRC, OUT);

  // inject project list into copied docs (if applicable)
  await injectProjects();

  console.log('Rewriting HTML paths in docs/ ...');
  await rewriteHtmlFiles(OUT);
  console.log('Build complete.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});