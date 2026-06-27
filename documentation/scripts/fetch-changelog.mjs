import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'invoicerr-app';
const REPO = 'invoicerr';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = resolve(__dirname, '..', 'changelog');

function slugify(tag) {
  return tag.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function fetchAllReleases() {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let allReleases = [];
  let url = API_URL;

  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    allReleases = allReleases.concat(await res.json());

    const link = res.headers.get('link');
    const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  return allReleases.filter((r) => !r.draft);
}

function generatePost(release) {
  const date = release.published_at?.split('T')[0] ?? 'Unknown date';
  const body = (release.body ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  const frontmatter = [
    '---',
    `title: ${release.tag_name}`,
    `date: ${date}`,
    'tags: [release]',
    '---',
  ].join('\n');

  const lines = body.split('\n');
  if (lines.length <= 10) {
    return `${frontmatter}\n\n${body}\n`;
  }

  const before = lines.slice(0, 10).join('\n');
  const after = lines.slice(10).join('\n');
  return `${frontmatter}\n\n${before}\n\n{/* truncate */}\n\n${after}\n`;
}

function existingTags() {
  if (!readdirSync(BLOG_DIR)) return new Set();
  const tags = new Set();
  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith('.md')) continue;
    const match = file.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
    if (match) tags.add(match[1]);
  }
  return tags;
}

try {
  console.log('Fetching releases from GitHub API...');
  const releases = await fetchAllReleases();
  console.log(`Found ${releases.length} releases total.`);

  mkdirSync(BLOG_DIR, { recursive: true });

  const localTags = existingTags();
  const generatedFiles = new Set();
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const release of releases) {
    const date = release.published_at?.split('T')[0];
    if (!date) continue;

    const slug = slugify(release.tag_name);
    const filename = `${date}-${slug}.md`;
    const filePath = join(BLOG_DIR, filename);

    const content = generatePost(release);
    generatedFiles.add(filename);

    if (!localTags.has(slug)) {
      writeFileSync(filePath, content, 'utf-8');
      newCount++;
    } else {
      const existing = readFileSync(filePath, 'utf-8');
      if (existing !== content) {
        writeFileSync(filePath, content, 'utf-8');
        updatedCount++;
      } else {
        unchangedCount++;
      }
    }
  }

  for (const file of readdirSync(BLOG_DIR)) {
    if (file.endsWith('.md') && !generatedFiles.has(file)) {
      unlinkSync(join(BLOG_DIR, file));
      console.log(`  Removed stale file: ${file}`);
    }
  }

  console.log(`New: ${newCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}, Total: ${generatedFiles.size}`);
} catch (err) {
  console.error('Failed to generate changelog:', err.message);
  process.exit(1);
}
