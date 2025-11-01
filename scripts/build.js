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
  console.log('Rewriting HTML paths in docs/ ...');
  await rewriteHtmlFiles(OUT);
  console.log('Build complete.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
