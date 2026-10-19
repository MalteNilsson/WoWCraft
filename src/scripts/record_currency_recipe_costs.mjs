import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { wowheadHtmlHeaders } from './wowheadFetchHeaders.js';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const professions = ['alchemy', 'blacksmithing', 'cooking', 'enchanting', 'engineering', 'leatherworking', 'tailoring'];
const CONCURRENCY = 6;

class WowheadBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WowheadBlockedError';
  }
}

function extractBalanced(str, start, openCh, closeCh) {
  const i = str.indexOf(openCh, start);
  if (i === -1) return null;
  let depth = 0;
  let inStr = false;
  let strCh = null;
  let j = i;
  while (j < str.length) {
    const c = str[j];
    if (!inStr) {
      if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; }
      else if (c === openCh) depth++;
      else if (c === closeCh) { depth--; if (depth === 0) return str.substring(i, j + 1); }
    } else if (c === '\\') j++;
    else if (c === strCh) inStr = false;
    j++;
  }
  return null;
}

function parseList(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const raw = extractBalanced(html, idx + marker.length - 1, '[', ']');
  if (!raw) return null;
  return new Function('return ' + raw)();
}

function readGatherer(html, typeId) {
  const needle = `WH.Gatherer.addData(${typeId},`;
  const idx = html.indexOf(needle);
  if (idx === -1) return {};
  const raw = extractBalanced(html, idx + needle.length, '{', '}');
  if (!raw) return {};
  try { return new Function('return ' + raw)(); } catch { return {}; }
}

/** Vendor cost tuples are [copper, itemId, count] or [copper, [[currencyId, qty], ...], extras]. */
function parseCostTuple(tuple) {
  const copper = Number(tuple?.[0]) || 0;
  const currencies = [];
  const second = tuple?.[1];
  if (Array.isArray(second)) {
    for (const entry of second) {
      if (!Array.isArray(entry)) continue;
      const id = Number(entry[0]);
      const quantity = Number(entry[1]);
      if (id > 0 && quantity > 0) currencies.push({ id, quantity });
    }
  } else if (Number(second) > 0) {
    const quantity = Number(tuple?.[2]) || 1;
    currencies.push({ id: Number(second), quantity });
  }
  return { copper, currencies };
}

function parseItemPage(html) {
  const soldByIdx = html.search(/id:\s*['"]sold-by['"]/);
  let currencies = [];
  let copper = 0;
  if (soldByIdx >= 0) {
    const dataIdx = html.indexOf('data:', soldByIdx);
    const arrayStart = html.indexOf('[', dataIdx);
    const raw = extractBalanced(html, arrayStart - 1, '[', ']');
    if (raw) {
      try {
        const vendors = new Function('return ' + raw)();
        if (Array.isArray(vendors)) {
          for (const vendor of vendors) {
            const costs = Array.isArray(vendor?.cost) ? vendor.cost : [];
            for (const tuple of costs) {
              const parsed = parseCostTuple(tuple);
              if (parsed.currencies.length) {
                currencies = parsed.currencies;
                copper = parsed.copper;
                break;
              }
            }
            if (currencies.length) break;
          }
        }
      } catch { /* ignore malformed sold-by data */ }
    }
  }

  const names = readGatherer(html, 17);
  const spellMatch = html.match(/"spellModifiers":\[([0-9,]+)\]/);
  const spellIds = spellMatch ? spellMatch[1].split(',').map((id) => Number(id)).filter(Boolean) : [];
  return {
    currencies: currencies.map((entry) => ({
      id: entry.id,
      name: names[String(entry.id)]?.name_enus || '',
      quantity: entry.quantity,
    })),
    copper,
    spellIds,
  };
}

async function fetchText(url, cookie) {
  const res = await fetch(url, {
    headers: { ...wowheadHtmlHeaders, Cookie: cookie },
    redirect: 'follow',
  });
  const body = await res.text();
  if (res.status === 403 || (body.includes('403 ERROR') && body.toLowerCase().includes('cloudfront'))) {
    throw new WowheadBlockedError('CloudFront 403. Switch to a new VPN server, then run the scraper again.');
  }
  return { status: res.status, body };
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  const firstUrl = 'https://www.wowhead.com/forever/items/recipes/leatherworking';
  await page.goto(firstUrl, { waitUntil: 'load', timeout: 60000 });
  const deadline = Date.now() + 50000;
  let cookie = '';
  while (Date.now() < deadline) {
    const blocked = await page.evaluate(() => (document.body?.innerText || '').includes('403 ERROR')).catch(() => false);
    if (blocked) throw new WowheadBlockedError('CloudFront 403. Switch to a new VPN server, then run the scraper again.');
    const ready = await page.evaluate(() => document.documentElement.innerHTML.includes('var listviewitems')).catch(() => false);
    const cookies = await page.cookies('https://www.wowhead.com');
    if (ready && cookies.some((c) => c.name === 'aws-waf-token')) {
      cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!cookie) throw new Error('AWS WAF token was not acquired');
  const pages = { leatherworking: await page.content() };
  await page.close();
  console.log('WAF token acquired');

  for (const profession of professions) {
    if (pages[profession]) continue;
    const url = `https://www.wowhead.com/forever/items/recipes/${profession}`;
    const { status, body } = await fetchText(url, cookie);
    if (!body.includes('var listviewitems')) {
      console.log(`No recipe item list for ${profession} (HTTP ${status})`);
      continue;
    }
    pages[profession] = body;
    console.log(`Listed ${profession}`);
  }

  const vendorItems = [];
  for (const [profession, html] of Object.entries(pages)) {
    const items = parseList(html, 'var listviewitems = ') || [];
    for (const item of items) {
      if (Array.isArray(item.source) && item.source[0] === 5) {
        vendorItems.push({ profession, id: item.id, name: item.name || item.displayName || '' });
      }
    }
  }
  console.log(`Vendor recipe items: ${vendorItems.length}`);

  const recipesBySpell = new Map();
  const recipeFiles = {};
  for (const profession of professions) {
    const file = path.join(root, 'src/data/recipes/forever', `${profession}.json`);
    const recipes = JSON.parse(await fs.readFile(file, 'utf8'));
    recipeFiles[profession] = { file, recipes };
    for (const recipe of recipes) recipesBySpell.set(recipe.id, { profession, recipe });
  }

  const progressPath = path.join(root, 'src/data/sod/currency-recipe-costs.json');
  let updates = [];
  let checkedIds = [];
  try {
    const saved = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    if (Array.isArray(saved)) {
      updates = saved;
      checkedIds = saved.map((row) => row.recipeItemId);
    } else {
      updates = saved.updates || [];
      checkedIds = saved.checkedItemIds || [];
    }
  } catch { /* first run */ }
  const doneItems = new Set(checkedIds);
  const pending = vendorItems.filter((item) => !doneItems.has(item.id));
  console.log(`Already checked ${doneItems.size}. Fetching ${pending.length} vendor patterns.`);

  const saveProgress = async () => {
    await fs.mkdir(path.dirname(progressPath), { recursive: true });
    await fs.writeFile(progressPath, JSON.stringify({ checkedItemIds: checkedIds, updates }, null, 2) + '\n');
  };

  const applyUpdates = async () => {
    const byProfession = {};
    for (const update of updates) {
      const found = recipesBySpell.get(update.spellId);
      if (!found) continue;
      found.recipe.source = {
        type: 'item',
        recipeItemId: update.recipeItemId,
        recipeItemName: update.recipeItemName,
        currencyCost: update.currencyCost,
        ...(update.cost ? { cost: update.cost } : {}),
      };
      byProfession[found.profession] = (byProfession[found.profession] || 0) + 1;
    }
    for (const profession of professions) {
      const entry = recipeFiles[profession];
      if (!entry || !byProfession[profession]) continue;
      await fs.writeFile(entry.file, JSON.stringify(entry.recipes, null, 2) + '\n');
    }
    await saveProgress();
    return byProfession;
  };

  let checked = 0;
  try {
    await mapPool(pending, CONCURRENCY, async (item) => {
      const { body } = await fetchText(`https://www.wowhead.com/forever/item=${item.id}`, cookie);
      checkedIds.push(item.id);
      checked++;
      if (checked % 25 === 0) {
        await saveProgress();
        console.log(`Checked ${checked}/${pending.length}`);
      }
      const parsed = parseItemPage(body);
      if (!parsed.currencies.length) return;
      const spellId = parsed.spellIds.find((id) => recipesBySpell.has(id));
      if (!spellId) {
        console.log(`No taught spell for item ${item.id} ${item.name} spells=${parsed.spellIds.join(',')}`);
        return;
      }
      updates.push({
        spellId,
        recipeItemId: item.id,
        recipeItemName: item.name,
        currencyCost: parsed.currencies,
        ...(parsed.copper > 0 ? { cost: parsed.copper } : {}),
      });
    });
  } catch (err) {
    const byProfession = await applyUpdates();
    console.log('Saved partial results', updates.length, byProfession);
    throw err;
  }

  const byProfession = await applyUpdates();
  const currencyNames = new Map();
  for (const update of updates) {
    for (const cost of update.currencyCost) {
      const key = `${cost.id}:${cost.name}`;
      currencyNames.set(key, (currencyNames.get(key) || 0) + 1);
    }
  }
  console.log('Updated recipes', updates.length, byProfession);
  console.log('Currencies', [...currencyNames.entries()].map(([key, count]) => `${key} x${count}`).join('\n'));
} catch (err) {
  if (err instanceof WowheadBlockedError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
} finally {
  await browser.close();
}
