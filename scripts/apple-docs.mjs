// Downloads Apple's Human Interface Guidelines (and selected UIKit reference
// pages) as Markdown, so a working session can read the platform guidance
// without scraping JavaScript-rendered pages.
//
// The pages are Apple's copyrighted material: the download is for local
// reference only and the output directory is git-ignored. What the repository
// keeps is this script, the list of pages in `docs/reference/apple-hig.md`,
// and our own summaries — never the text itself.
//
//   node scripts/apple-docs.mjs [--out <dir>] [--hig] [--uikit]
//
// Apple serves each page's content as JSON:
//   https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json
//   https://developer.apple.com/tutorials/data/documentation/uikit/<symbol>.json
// The rendered page contains only a title to a scraper.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const out = path.resolve(value('--out', path.join(root, '.apple-docs')));
const wantHig = flag('--hig') || !flag('--uikit');
const wantUikit = flag('--uikit');

const HIG_BASE =
  'https://developer.apple.com/tutorials/data/design/human-interface-guidelines';
const UIKIT_BASE =
  'https://developer.apple.com/tutorials/data/documentation/uikit';

/** UIKit pages that describe behaviour our primitives implement. */
const uikitSymbols = [
  'uiscrollview',
  'uiscrollviewdelegate',
  'uitableview',
  'uitableviewcell',
  'uicollectionview',
  'uicollectionviewlayout',
  'uibutton',
  'uislider',
  'uiswitch',
  'uisegmentedcontrol',
  'uitextfield',
  'uitextview',
  'uipagecontrol',
  'uinavigationcontroller',
  'uitabbarcontroller',
  'uipresentationcontroller',
  'uialertcontroller',
  'uiactivityindicatorview',
  'uivisualeffectview',
  'uiscreen',
  'uitraitcollection',
  'uigesturerecognizer',
  'uipangesturerecognizer',
  'uihapticfeedbackgenerator',
  'uifeedbackgenerator',
  'uiactivityviewcontroller',
  'uipasteboard',
  'uiapplication',
  'uiviewcontroller',
  'uiaccessibility',
];

const get = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  // `fetch` follows the redirects Apple uses for renamed pages.
  if (!response.ok) return undefined;
  return response.json();
};

/**
 * Collects every page identifier a document links to: `reference` nodes and
 * the `topicSections`/`sections` lists, which hold identifiers in plain
 * arrays rather than nodes.
 */
function references(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) references(item, found);
  } else if (node && typeof node === 'object') {
    if (
      (node.type === 'reference' || node.type === 'link') &&
      typeof node.identifier === 'string'
    )
      found.add(node.identifier);
    if (Array.isArray(node.identifiers))
      for (const id of node.identifiers)
        if (typeof id === 'string') found.add(id);
    for (const value of Object.values(node)) references(value, found);
  }
  return found;
}

const isHig = (id) =>
  !id.includes('#') && /\/design\/human-interface-guidelines\//i.test(id);

/** Renders a DocC JSON node as Markdown. */
function markdown(node, depth = 0) {
  if (Array.isArray(node))
    return node.map((item) => markdown(item, depth)).join('');
  if (!node || typeof node !== 'object') return '';
  const inline = (value) =>
    Array.isArray(value)
      ? value.map((part) => markdown(part, depth)).join('')
      : '';
  const type = node.type;
  switch (type) {
    case 'text':
      return String(node.text ?? '');
    case 'codeVoice':
      return '`' + String(node.code ?? '') + '`';
    case 'emphasis':
      return '_' + inline(node.inlineContent) + '_';
    case 'strong':
      return '**' + inline(node.inlineContent) + '**';
    case 'reference':
    case 'link':
      return (
        inline(node.inlineContent) ||
        String(node.title ?? node.identifier ?? '')
      );
    case 'image':
      return `[image: ${node.identifier ?? ''}]`;
    case 'heading':
      return `\n${'#'.repeat(Math.min(6, (node.level ?? 2) + 1))} ${String(node.text ?? '')}\n\n`;
    case 'paragraph':
      return inline(node.inlineContent) + '\n\n';
    case 'unorderedList':
      return (
        (node.items ?? [])
          .map((item) => '- ' + markdown(item.content ?? item).trim())
          .join('\n') + '\n\n'
      );
    case 'orderedList':
      return (
        (node.items ?? [])
          .map(
            (item, index) =>
              `${index + 1}. ` + markdown(item.content ?? item).trim(),
          )
          .join('\n') + '\n\n'
      );
    case 'aside':
      return `> ${String(node.name ?? 'Note')}: ${inline(node.content ?? node.inlineContent).trim()}\n\n`;
    default:
      if (node.content) return markdown(node.content, depth + 1);
      if (node.inlineContent) return inline(node.inlineContent);
      return '';
  }
}

function article(json, source) {
  const lines = [];
  const title = json.metadata?.title ?? 'Untitled';
  lines.push(`# ${title}`, '', `Source: ${source}`, '');
  if (json.abstract) lines.push(markdown(json.abstract).trim(), '');
  for (const section of json.primaryContentSections ?? []) {
    lines.push(markdown(section.content ?? section).trim(), '');
  }
  for (const section of json.sections ?? []) {
    if (section.kind === 'content')
      lines.push(markdown(section.content).trim(), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function hig() {
  const directory = path.join(out, 'hig');
  mkdirSync(directory, { recursive: true });
  const index = await get(`${HIG_BASE}.json`);
  if (!index) throw new Error('Cannot read the HIG index');
  const seen = new Set();
  const queue = [...references(index)]
    .filter(isHig)
    .map((id) => id.split('/').pop());
  const pages = [];
  while (queue.length > 0) {
    const slug = queue.shift();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const json = await get(`${HIG_BASE}/${slug}.json`);
    if (!json) {
      process.stdout.write(`  ${slug}: not found\n`);
      continue;
    }
    for (const id of references(json)) {
      if (!isHig(id)) continue;
      const next = id.split('/').pop();
      if (next && !seen.has(next)) queue.push(next);
    }
    const text = article(json, `${HIG_BASE}/${slug}.json`);
    writeFileSync(path.join(directory, `${slug}.md`), text);
    pages.push({ slug, title: json.metadata?.title ?? slug });
    process.stdout.write(`  ${slug}\n`);
  }
  pages.sort((a, b) => a.title.localeCompare(b.title));
  writeFileSync(
    path.join(directory, 'INDEX.md'),
    [
      '# Apple Human Interface Guidelines, downloaded',
      '',
      `Fetched ${new Date().toISOString()} by \`scripts/apple-docs.mjs\`. Apple copyright; local reference only.`,
      '',
      ...pages.map((page) => `- [${page.title}](./${page.slug}.md)`),
      '',
    ].join('\n'),
  );
  console.log(`${pages.length} HIG pages in ${directory}`);
}

async function uikit() {
  const directory = path.join(out, 'uikit');
  mkdirSync(directory, { recursive: true });
  let count = 0;
  for (const symbol of uikitSymbols) {
    const json = await get(`${UIKIT_BASE}/${symbol}.json`);
    if (!json) {
      process.stdout.write(`  ${symbol}: not found\n`);
      continue;
    }
    writeFileSync(
      path.join(directory, `${symbol}.md`),
      article(json, `${UIKIT_BASE}/${symbol}.json`),
    );
    count++;
    process.stdout.write(`  ${symbol}\n`);
  }
  writeFileSync(
    path.join(directory, 'INDEX.md'),
    [
      '# UIKit reference pages, downloaded',
      '',
      `Fetched ${new Date().toISOString()} by \`scripts/apple-docs.mjs\`. Apple copyright; local reference only.`,
      '',
      ...uikitSymbols.map((symbol) => `- [${symbol}](./${symbol}.md)`),
      '',
    ].join('\n'),
  );
  console.log(`${count} UIKit pages in ${directory}`);
}

if (wantHig) await hig();
if (wantUikit) await uikit();
