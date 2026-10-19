// src/scripts/scrape_all_professions.js

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());
import { parseStringPromise } from 'xml2js';
import archiver from 'archiver';
import { wowheadHtmlHeaders, wowheadXmlHeaders, WOWHEAD_USER_AGENT } from './wowheadFetchHeaders.js';

const streamPipeline = promisify(pipeline);

const PROFESSIONS = [
  'alchemy',
  'blacksmithing',
  'cooking',
  'enchanting',
  'engineering',
  'jewelcrafting',
  'leatherworking',
  'tailoring',
];

// Game versions and their WoWhead URL paths
const GAME_VERSIONS = ['Vanilla', 'The Burning Crusade', 'Forever'];
const VERSION_BASE_URLS = {
  'Vanilla': 'https://www.wowhead.com/classic/spells/professions/',
  'The Burning Crusade': 'https://www.wowhead.com/tbc/spells/professions/',
  'Forever': 'https://www.wowhead.com/forever/spells/professions/',
};
const VERSION_SECONDARY_URLS = {
  'Vanilla': 'https://www.wowhead.com/classic/spells/secondary-skills/',
  'The Burning Crusade': 'https://www.wowhead.com/tbc/spells/secondary-skills/',
  'Forever': 'https://www.wowhead.com/forever/spells/secondary-skills/',
};
const VERSION_FILTERS = {
  'Vanilla': '?filter=20:21;1:5;0:11400',
  'The Burning Crusade': '?filter=20;1;0',
  'Forever': '?filter=20;1;0',
};

// Jewelcrafting only exists in TBC
const TBC_ONLY_PROFESSIONS = ['jewelcrafting'];

/**
 * List page URL for a profession on Wowhead.
 * Cooking is under secondary-skills, not professions (see e.g. TBC:
 * https://www.wowhead.com/tbc/spells/secondary-skills/cooking?filter=20;1;0 ).
 */
function getProfessionListUrl(version, profession) {
  const filterQuery = VERSION_FILTERS[version] || VERSION_FILTERS['Vanilla'];
  if (profession === 'cooking') {
    const prefix = VERSION_SECONDARY_URLS[version] || VERSION_SECONDARY_URLS['Vanilla'];
    return `${prefix}cooking${filterQuery}`;
  }
  const baseUrl = VERSION_BASE_URLS[version];
  return `${baseUrl}${profession}${filterQuery}`;
}

/** Site root for spell/item links, e.g. https://www.wowhead.com/tbc/ */
function getSpellBaseUrlForVersion(version) {
  const baseUrl = VERSION_BASE_URLS[version];
  return baseUrl.replace(/\/spells\/professions\/?$/, '/') || baseUrl.split('/spells/')[0] + '/';
}

// Directory names for version-specific recipe storage
const VERSION_TO_DIR = { 'Vanilla': 'vanilla', 'The Burning Crusade': 'tbc', 'Forever': 'forever' };

// Reusable page pool size for recipe detail scraping (avoids creating/destroying pages per batch)
// Reduced from 25 to limit concurrent requests and avoid 403 blocks
const RECIPE_DETAIL_POOL_SIZE = 10;

// Page load: networkidle* can hang on ad-heavy sites (ads keep connections open).
// 'load' fires when document + resources are done; more reliable than networkidle.
const PAGE_LOAD_WAIT = 'load';
const SELECTOR_TIMEOUT_MS = 60000;  // TBC/Classic pages can be slow to render

// Listview selectors to try (TBC/Classic may use different IDs; .listview is fallback)
const LISTVIEW_SELECTORS = ['#lv-spells', '.listview', '[id^="lv-"]'];

const args = process.argv.slice(2); // Get command line args

// Parse command line arguments
const phases = {
  scrape: true,
  enrich: true,
  downloadIcons: true,
  zip: true,
  recipeItems: false
};

let requestedProfession = null;
let requestedVersion = null; // null = both versions
let runHeaded = false; // --headed = visible browser (harder for sites to detect)

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--phase' || arg === '-p') {
    const phaseArg = args[i + 1];
    if (phaseArg) {
      // Reset all phases, then enable only specified ones
      phases.scrape = false;
      phases.enrich = false;
      phases.downloadIcons = false;
      phases.zip = false;
      
      const phaseList = phaseArg.split(',');
      phaseList.forEach(phase => {
        const trimmed = phase.trim();
        if (trimmed === 'scrape') phases.scrape = true;
        if (trimmed === 'enrich') phases.enrich = true;
        if (trimmed === 'icons' || trimmed === 'downloadIcons') phases.downloadIcons = true;
        if (trimmed === 'zip') phases.zip = true;
        if (trimmed === 'recipe-items') phases.recipeItems = true;
      });
      i++; // Skip next arg as it's the phase value
    }
  } else if (arg === '--version' || arg === '-v') {
    const ver = args[i + 1]?.toLowerCase();
    if (ver === 'vanilla') requestedVersion = 'Vanilla';
    else if (ver === 'tbc' || ver === 'the burning crusade') requestedVersion = 'The Burning Crusade';
    else if (ver === 'forever' || ver === 'wow forever' || ver === 'wow: forever') requestedVersion = 'Forever';
    i++;
  } else if (arg === '--profession' || arg === '-prof') {
    requestedProfession = args[i + 1];
    i++; // Skip next arg as it's the profession value
  } else if (arg === '--headed') {
    runHeaded = true;
  } else if (!arg.startsWith('-') && PROFESSIONS.includes(arg)) {
    // Legacy support: first non-flag arg is profession
    requestedProfession = arg;
  }
}

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scrape_all_professions.js [options]

Options:
  --profession <name>  Scrape only specified profession (${PROFESSIONS.join(', ')})
  --version <ver>      Scrape only specified version (vanilla, tbc, forever). Default: all
  --phase <phases>     Run only specified phases (comma-separated)
                       Available phases: scrape, enrich, icons, zip, recipe-items
  --headed             Run browser visibly (helps avoid 403 blocks)
  --help, -h           Show this help message

Examples:
  node scrape_all_professions.js --profession enchanting
  node scrape_all_professions.js --phase enrich
  node scrape_all_professions.js --profession enchanting --phase scrape,enrich
  `);
  process.exit(0);
}

const globalMaterialIds = new Set();
const globalMaterialData = {};
// Version-keyed materials for separate vanilla/tbc enrichment
const globalMaterialDataByVersion = { vanilla: {}, tbc: {}, forever: {} };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Zip each icon subdirectory (materials, alchemy, etc.) into a .zip file. Can run standalone via --phase zip. */
async function zipIcons() {
  const projectRoot = path.join(__dirname, '..', '..');
  const iconsDir = path.join(projectRoot, 'public', 'icons');
  const entries = await fs.readdir(iconsDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  for (const dirName of dirs) {
    const dirPath = path.join(iconsDir, dirName);
    const files = await fs.readdir(dirPath);
    const jpgFiles = files.filter(f => f.endsWith('.jpg'));
    if (jpgFiles.length === 0) continue;

    const zipPath = path.join(iconsDir, `${dirName}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(dirPath, false);
      archive.finalize();
    });

    const stats = await fs.stat(zipPath);
    console.log(`Zipped ${dirName}: ${jpgFiles.length} icons -> ${dirName}.zip (${(stats.size / 1024).toFixed(1)} KB)`);
  }
}



/** Cookie from one solved AWS WAF challenge, reused by later fetch calls. */
let wowheadCookieHeader = '';
let wowheadSessionPageUrl = null;
let wowheadSolvePromise = null;

class WowheadBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WowheadBlockedError';
  }
}

function withWowheadCookie(headers) {
  if (!wowheadCookieHeader) return headers;
  return { ...headers, Cookie: wowheadCookieHeader };
}

function looksLikeWafChallenge(status, body, wafAction) {
  if (status === 202 || wafAction === 'challenge') return true;
  return typeof body === 'string' && body.includes('gokuProps') && body.includes('awsWafCookieDomainList');
}

function looksLikeCloudFront403(status, body) {
  return status === 403 || (
    typeof body === 'string' &&
    body.includes('403 ERROR') &&
    body.toLowerCase().includes('cloudfront')
  );
}

function challengePageUrl(fallbackUrl) {
  if (wowheadSessionPageUrl) return wowheadSessionPageUrl;
  if (fallbackUrl && !fallbackUrl.includes('&xml')) return fallbackUrl;
  const version = requestedVersion || 'Vanilla';
  return getProfessionListUrl(version, 'alchemy');
}

/** Let the real challenge script run once, then keep its cookie for fetch. */
async function ensureWowheadSession(browser, fallbackUrl) {
  if (wowheadSolvePromise) return wowheadSolvePromise;
  wowheadSolvePromise = (async () => {
    const url = challengePageUrl(fallbackUrl);
    const page = await browser.newPage();
    try {
      console.log('Solving AWS WAF challenge in the browser...');
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      const deadline = Date.now() + 45000;
      let solved = false;
      while (Date.now() < deadline) {
        try {
          const blocked = await page.evaluate(() => (document.body?.innerText || '').includes('403 ERROR'));
          if (blocked) {
            throw new WowheadBlockedError('CloudFront 403 while solving the AWS WAF challenge. Switch to a new VPN server, then run the scraper again.');
          }
          const cookies = await page.cookies('https://www.wowhead.com');
          const htmlLength = await page.evaluate(() => document.documentElement.innerHTML.length);
          if (cookies.some((cookie) => cookie.name === 'aws-waf-token') && htmlLength > 20000) {
            wowheadCookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
            wowheadSessionPageUrl = url;
            solved = true;
            break;
          }
        } catch (err) {
          if (err instanceof WowheadBlockedError) throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!solved) throw new Error('AWS WAF challenge did not set a token');
      console.log('AWS WAF token acquired. Later requests use fetch.');
    } finally {
      await page.close();
    }
  })();
  try {
    await wowheadSolvePromise;
  } finally {
    wowheadSolvePromise = null;
  }
}

async function fetchWowheadText(url, headers, browser) {
  const request = async () => {
    const res = await fetch(url, {
      headers: withWowheadCookie(headers),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, waf: res.headers.get('x-amzn-waf-action') };
  };

  let result = await request();
  if (looksLikeCloudFront403(result.status, result.body)) {
    throw new WowheadBlockedError('CloudFront 403. Switch to a new VPN server, then run the scraper again.');
  }
  if (looksLikeWafChallenge(result.status, result.body, result.waf)) {
    if (!browser) throw new Error('AWS WAF challenge');
    await ensureWowheadSession(browser, url);
    result = await request();
    if (looksLikeCloudFront403(result.status, result.body)) {
      throw new WowheadBlockedError('CloudFront 403. Switch to a new VPN server, then run the scraper again.');
    }
    if (looksLikeWafChallenge(result.status, result.body, result.waf)) {
      throw new Error('AWS WAF challenge was not accepted by fetch');
    }
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status}`);
  }
  return result.body;
}

/** Fetch listview data from HTML. A browser solves the WAF challenge once; fetch reuses that cookie. */
const fetchListviewData = async (url, browser) => {
  const html = await fetchWowheadText(url, wowheadHtmlHeaders, browser);
  if (!html.includes('var listviewspells = ')) {
    throw new Error('Could not find listviewspells in HTML');
  }
  return html;
};

/** Extract balanced bracket/brace content (handles nested structures) */
const extractBalanced = (str, start, openCh, closeCh) => {
  const i = str.indexOf(openCh, start);
  if (i === -1) return null;
  let depth = 0;
  let inStr = false;
  let strCh = null;
  let j = i;
  while (j < str.length) {
    const c = str[j];
    if (!inStr) {
      if (c === '"' || c === "'" || c === '`') {
        inStr = true;
        strCh = c;
      } else if (c === openCh) {
        depth++;
      } else if (c === closeCh) {
        depth--;
        if (depth === 0) return str.substring(i, j + 1);
      }
    } else {
      if (c === '\\') j++;
      else if (c === strCh) inStr = false;
    }
    j++;
  }
  return null;
};

/** Sold-by listview embedded in item HTML. No browser render required. */
function parseSoldByFromHtml(html) {
  const empty = { hasCurrencyPrice: false, limitedStock: false };
  const soldByIdx = html.search(/id:\s*['"]sold-by['"]/);
  if (soldByIdx === -1) return empty;

  const dataIdx = html.indexOf('data:', soldByIdx);
  if (dataIdx === -1) return empty;

  const arrayStart = html.indexOf('[', dataIdx);
  if (arrayStart === -1) return empty;

  const dataStr = extractBalanced(html, arrayStart - 1, '[', ']');
  if (!dataStr) return empty;

  let vendors;
  try {
    vendors = new Function('return ' + dataStr)();
  } catch {
    return empty;
  }
  if (!Array.isArray(vendors)) return empty;

  let hasCurrencyPrice = false;
  let limitedStock = false;
  for (const vendor of vendors) {
    const costs = Array.isArray(vendor?.cost) ? vendor.cost : [];
    for (const entry of costs) {
      const parts = Array.isArray(entry) ? entry : [entry];
      const copper = Number(parts[0]) || 0;
      const itemId = parts.length > 1 ? Number(parts[1]) || 0 : 0;
      if (copper > 0 && itemId <= 0) {
        hasCurrencyPrice = true;
        if (typeof vendor.stock === 'number' && vendor.stock >= 0) limitedStock = true;
      }
    }
  }
  return { hasCurrencyPrice, limitedStock };
}

/** Parse limited stock from item HTML - extracts sold-by Listview data (no scripts required) */
function parseLimitedStockFromHtml(html) {
  return parseSoldByFromHtml(html).limitedStock;
}

/** Tabs that are not a way to obtain the item. */
const NON_SOURCE_LISTVIEWS = new Set([
  'comments',
  'screenshots',
  'videos',
  'videos-english',
  'add-your-comment',
  'submit-a-screenshot',
  'suggest-a-video',
  'submit-your-data',
  'creates',
  'guides',
]);

function itemListviewIds(html) {
  return [...html.matchAll(/new Listview\(\{[^}]*id:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

/** True when the item page lists a drop, vendor, quest, container, or similar source. */
function itemHasAcquisitionSource(html) {
  return itemListviewIds(html).some((id) => !NON_SOURCE_LISTVIEWS.has(id));
}

/** Bind-on-pickup item whose page lists a mob drop and no vendor or quest. */
function itemIsBopMobDrop(html) {
  const lists = new Set(itemListviewIds(html));
  if (!lists.has('dropped-by')) return false;
  if (lists.has('sold-by') || lists.has('reward-from') || lists.has('reward-from-q')) return false;
  return true;
}

/** Ways to obtain an item that are not a token vendor. */
const OTHER_ACQUISITION_LISTVIEWS = new Set([
  'dropped-by',
  'reward-from',
  'reward-from-q',
  'contained-in-object',
  'contained-in-item',
  'pickpocketed-from',
  'skinned-from',
  'mined-from',
  'gathered-from',
  'herbed-from',
  'fished-in',
  'disenchanting',
  'created-by',
  'objective-of',
  'provided-for',
]);

/** Name of one item inside WH.Gatherer.addData, not the next name elsewhere on the page. */
function gathererItemName(html, id) {
  const needle = 'WH.Gatherer.addData(';
  const key = String(id);
  let from = 0;
  while (from < html.length) {
    const idx = html.indexOf(needle, from);
    if (idx === -1) break;
    const typeEnd = html.indexOf(',', idx + needle.length);
    if (typeEnd === -1) break;
    const typeId = Number(html.slice(idx + needle.length, typeEnd));
    const objStart = html.indexOf('{', typeEnd);
    if (objStart === -1) break;
    const obj = extractBalanced(html, objStart, '{', '}');
    if (!obj) break;
    from = objStart + obj.length;
    if (typeId !== 3 && typeId !== 17) continue;
    try {
      const row = new Function('return ' + obj)()?.[key];
      const name = row?.name_enus || row?.name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch { /* keep scanning later gatherer blobs */ }
  }
  return '';
}

function pageItemName(html) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
  return title.replace(/\s+[-–|].*$/, '').trim();
}

const currencyNameCache = new Map();

/** Fill token names from the currency item's own page when the recipe page does not include them. */
async function namedCurrencyCosts(html, wowheadPath, browser) {
  const costs = parseCurrencyVendor(html);
  for (const cost of costs) {
    if (cost.name) continue;
    const cacheKey = `${wowheadPath}:${cost.id}`;
    if (!currencyNameCache.has(cacheKey)) {
      const currencyHtml = await fetchWowheadText(
        `https://www.wowhead.com/${wowheadPath}/item=${cost.id}`,
        wowheadHtmlHeaders,
        browser
      );
      currencyNameCache.set(cacheKey, gathererItemName(currencyHtml, cost.id) || pageItemName(currencyHtml));
    }
    cost.name = currencyNameCache.get(cacheKey);
  }
  return costs;
}

/** Token costs from sold-by. Empty when the item is also a quest, drop, container, or gold purchase. */
function parseCurrencyVendor(html) {
  const lists = new Set(itemListviewIds(html));
  if ([...lists].some((id) => OTHER_ACQUISITION_LISTVIEWS.has(id))) return [];

  const soldByIdx = html.search(/id:\s*['"]sold-by['"]/);
  if (soldByIdx === -1) return [];
  const dataIdx = html.indexOf('data:', soldByIdx);
  if (dataIdx === -1) return [];
  const arrayStart = html.indexOf('[', dataIdx);
  if (arrayStart === -1) return [];
  const dataStr = extractBalanced(html, arrayStart - 1, '[', ']');
  if (!dataStr) return [];

  let vendors;
  try {
    vendors = new Function('return ' + dataStr)();
  } catch {
    return [];
  }
  if (!Array.isArray(vendors)) return [];

  let currencies = [];
  let goldOnly = false;
  for (const vendor of vendors) {
    const costs = Array.isArray(vendor?.cost) ? vendor.cost : [];
    for (const tuple of costs) {
      if (!Array.isArray(tuple)) continue;
      const copper = Number(tuple[0]) || 0;
      const second = tuple[1];
      const found = [];
      if (Array.isArray(second)) {
        for (const entry of second) {
          if (!Array.isArray(entry)) continue;
          const id = Number(entry[0]);
          const quantity = Number(entry[1]);
          if (id > 0 && quantity > 0) found.push({ id, quantity });
        }
      } else if (Number(second) > 0) {
        const quantity = Number(tuple[2]) || 1;
        found.push({ id: Number(second), quantity });
      }
      if (found.length) {
        if (!currencies.length) currencies = found;
      } else if (copper > 0) {
        goldOnly = true;
      }
    }
  }
  if (goldOnly || !currencies.length) return [];
  return currencies.map((entry) => ({
    id: entry.id,
    name: gathererItemName(html, entry.id),
    quantity: entry.quantity,
  }));
}

/** WH.Gatherer.addData(type, env, {...}). The env id differs by game (classic 5, forever 16). */
function readGathererData(html, typeId) {
  const needle = `WH.Gatherer.addData(${typeId},`;
  const idx = html.indexOf(needle);
  if (idx === -1) return {};
  const obj = extractBalanced(html, idx + needle.length, '{', '}');
  if (!obj) return {};
  try {
    return new Function('return ' + obj)();
  } catch {
    return {};
  }
}

/** Parse listviewspells and WH.Gatherer.addData from WoWhead HTML */
const parseListviewFromHtml = (html, spellBaseUrl) => {
  const listviewIdx = html.indexOf('var listviewspells = ');
  if (listviewIdx === -1) throw new Error('Could not find listviewspells in HTML');
  const arrayStart = listviewIdx + 'var listviewspells = '.length;
  const spellsRaw = extractBalanced(html, arrayStart - 1, '[', ']');
  if (!spellsRaw) throw new Error('Could not extract listviewspells array');
  const spells = new Function('return ' + spellsRaw)();

  const spellIcons = readGathererData(html, 6);
  const itemData = readGathererData(html, 3);

  const recipes = spells.map((s) => {
    const materials = {};
    (s.reagents || []).forEach(([id, qty]) => {
      if (id && qty > 0) materials[String(id)] = qty;
    });
    const difficulty = {
      orange: s.colors?.[0] ?? null,
      yellow: s.colors?.[1] ?? null,
      green: s.colors?.[2] ?? null,
      gray: s.colors?.[3] ?? null,
    };
    const hasDifficulty = Object.values(difficulty).some((v) => typeof v === 'number' && !isNaN(v));
    if (!hasDifficulty) return null;

    const spellInfo = spellIcons[String(s.id)];
    const icon = spellInfo?.icon ?? '';

    let produces = null;
    if (s.creates && s.creates[0]) {
      produces = { id: s.creates[0], name: '', quantity: s.creates[1] ?? 1 };
    }

    // WoWhead source codes: [6] trainer, [5] recipe item, [1] drop (item id may follow).
    // Forever lists a recipe item as [5] without the item id, so the item page has to supply it.
    let source = { type: 'free' };
    if (s.source && Array.isArray(s.source)) {
      const codes = s.source;
      const listedItemId = (codes[0] === 1 || codes[0] === 5) && Number.isInteger(codes[1]) ? codes[1] : null;
      if (codes.includes(6) && s.trainingcost != null && !codes.includes(5)) {
        source = { type: 'trainer', cost: s.trainingcost };
      } else if (listedItemId) {
        source = { type: 'item', recipeItemId: listedItemId, recipeItemName: '' };
      } else if (codes.includes(5) || codes[0] === 1) {
        source = { type: 'item', recipeItemId: null, recipeItemName: '', _needsRecipeItem: true };
      }
    }

    return {
      id: s.id,
      name: s.name || '',
      quality: s.quality ?? 1,
      difficulty,
      materials,
      minSkill: difficulty.orange ?? null,
      icon,
      url: `${spellBaseUrl}spell=${s.id}`,
      produces,
      source,
    };
  }).filter((r) => r && r.id && r.name);

  return { recipes, itemData };
};

const RECIPE_ITEM_FETCH_CONCURRENCY = 500;
const scrapedRecipeItemDetails = new Map();

function xmlNodeText(node) {
  if (typeof node === 'string') return node.trim();
  if (node && typeof node._ === 'string') return node._.trim();
  return '';
}

/** Item level from Wowhead item XML: <level>, jsonEquip.itemlevel, or the tooltip ilvl marker. */
function itemLevelFromXmlItem(item) {
  const levelNode = item?.level?.[0];
  const levelParsed = parseInt(xmlNodeText(levelNode) || (typeof levelNode === 'number' ? String(levelNode) : ''), 10);
  if (Number.isFinite(levelParsed)) return levelParsed;
  const jsonEquipStr = item?.jsonEquip?.[0];
  if (typeof jsonEquipStr === 'string') {
    try {
      const json = JSON.parse(`{${jsonEquipStr}}`);
      const fromEquip = parseInt(json.itemlevel, 10);
      if (Number.isFinite(fromEquip)) return fromEquip;
    } catch { /* jsonEquip is not always an object literal */ }
  }
  const tooltip = xmlNodeText(item?.htmlTooltip?.[0]) || (typeof item?.htmlTooltip?.[0] === 'string' ? item.htmlTooltip[0] : '');
  const ilvlMatch = String(tooltip).match(/<!--ilvl-->(\d+)/);
  if (ilvlMatch) return parseInt(ilvlMatch[1], 10);
  return null;
}

function readListviewRows(html, listId) {
  const marker = `id: '${listId}'`;
  const at = html.indexOf(marker);
  if (at === -1) return [];
  const dataAt = html.indexOf('data:', at);
  if (dataAt === -1 || dataAt - at > 500) return [];
  const raw = extractBalanced(html, dataAt, '[', ']');
  if (!raw) return [];
  try {
    const rows = new Function('return ' + raw)();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

const FACTION_BY_QUEST_SIDE = { 1: 'Alliance', 2: 'Horde' };

/** Drops and containers are available to both factions, so a quest does not lock the recipe. */
const SHARED_ACQUISITION_LISTVIEWS = new Set([
  'dropped-by',
  'contained-in-object',
  'contained-in-item',
  'pickpocketed-from',
  'skinned-from',
  'mined-from',
  'gathered-from',
  'herbed-from',
  'fished-in',
  'disenchanting',
  'created-by',
]);

/** Wowhead react is [Alliance, Horde]. Null means that faction cannot buy from the vendor. */
function vendorFaction(vendor) {
  const react = vendor?.react;
  if (!Array.isArray(react)) return null;
  const alliance = react[0] != null;
  const horde = react[1] != null;
  if (alliance && horde) return 'Both';
  if (alliance) return 'Alliance';
  if (horde) return 'Horde';
  return null;
}

/**
 * Recipe item rewarded by a quest that only one faction can do.
 * A vendor for the other faction, or a drop, leaves the recipe available to both.
 */
function questFactionExclusive(html) {
  const lists = new Set(itemListviewIds(html));
  if (!lists.has('reward-from-q')) return null;
  if ([...lists].some((id) => SHARED_ACQUISITION_LISTVIEWS.has(id))) return null;

  const quests = readListviewRows(html, 'reward-from-q');
  if (!quests.length || quests.some((quest) => !FACTION_BY_QUEST_SIDE[quest.side])) return null;
  const sides = new Set(quests.map((quest) => FACTION_BY_QUEST_SIDE[quest.side]));
  if (sides.size !== 1) return null;
  const faction = [...sides][0];

  if (lists.has('sold-by')) {
    const vendors = readListviewRows(html, 'sold-by');
    if (!vendors.length || vendors.some((vendor) => vendorFaction(vendor) !== faction)) return null;
  }
  return faction;
}

/** Spell-page enrichment. A class-9 "used by" / "taught by" row is the recipe item. */
function parseSpellPageSource(html) {
  for (const listId of ['taught-by-item', 'used-by-item']) {
    const recipeItem = readListviewRows(html, listId).find((row) => row && row.classs === 9 && row.id && row.name);
    if (recipeItem) {
      return {
        type: 'item',
        recipeItemId: recipeItem.id,
        recipeItemName: recipeItem.name,
      };
    }
  }

  const costMatch = html.match(/Training cost:\s*\[money=(\d+)\]/) || html.match(/"trainingcost":(\d+)/);
  if (costMatch) {
    return { type: 'trainer', cost: parseInt(costMatch[1], 10) };
  }
  if (html.includes("id: 'taught-by-npc'")) {
    return { type: 'trainer', cost: 0 };
  }
  return { type: 'free' };
}

async function enrichRecipeSources(recipes, browser, version, profession) {
  const checkpointPath = path.join(__dirname, '..', 'data', '.wowhead-cache', 'sources', `${VERSION_TO_DIR[version]}-${profession}.json`);
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch {
    saved = {};
  }

  const pending = [];
  for (const recipe of recipes) {
    const previous = saved[recipe.id];
    if (previous) recipe.source = previous;
    else pending.push(recipe);
  }
  const already = recipes.length - pending.length;
  console.log(`  Enriching ${pending.length} recipe pages${already ? ` (${already} already saved)` : ''}`);

  let done = already;
  const total = recipes.length;
  let writeChain = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(saved);
    writeChain = writeChain.then(() => fs.mkdir(path.dirname(checkpointPath), { recursive: true }).then(() => fs.writeFile(checkpointPath, snapshot)));
    return writeChain;
  };

  try {
    await mapWithConcurrency(pending, RECIPE_ITEM_FETCH_CONCURRENCY, async (recipe) => {
      const html = await fetchWowheadText(recipe.url, wowheadHtmlHeaders, browser);
      recipe.source = parseSpellPageSource(html);
      saved[recipe.id] = recipe.source;
      done += 1;
      if (done % 25 === 0 || done === total) {
        await persist();
        console.log(`  Enriched ${done}/${total} recipes`);
      }
    });
  } finally {
    if (Object.keys(saved).length > 0) await persist();
  }

  const counts = { item: 0, trainer: 0, free: 0 };
  for (const recipe of recipes) counts[recipe.source?.type] = (counts[recipe.source?.type] || 0) + 1;
  console.log(`  Sources: ${counts.item} recipe items, ${counts.trainer} trainers, ${counts.free} free`);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** Try multiple selectors; return the first that matches */
const waitForAnySelector = async (page, selectors, opts = {}) => {
  const timeout = opts.timeout ?? SELECTOR_TIMEOUT_MS;
  const perSelector = Math.ceil(timeout / selectors.length);
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: perSelector });
      return sel;
    } catch {
      continue;
    }
  }
  throw new Error(`None of [${selectors.join(', ')}] appeared within ${timeout}ms`);
};

/** Wait until listview is dynamically loaded and populated with recipe rows (no static delay) */
const waitForListViewReady = async (page, listviewSelector, opts = {}) => {
  const timeout = opts.timeout ?? SELECTOR_TIMEOUT_MS;
  await page.waitForFunction(
    (sel) => {
      const lv = document.querySelector(sel);
      if (!lv) return false;
      const rows = lv.querySelectorAll('tbody tr');
      if (rows.length === 0) return false;
      // At least one row must have spell link (indicates data loaded, not skeleton)
      // Difficulty (span.r1) optional - some pages/rows may not have it
      const ready = Array.from(rows).some(r => r.querySelector('a[href*="spell="]'));
      return ready;
    },
    { timeout },
    listviewSelector
  );
};

const scrapeProfessionForVersion = async (browser, profession, version) => {
  const listUrl = getProfessionListUrl(version, profession);
  const spellBaseUrl = getSpellBaseUrlForVersion(version);

  console.log(`\nScraping: ${profession} (${version})`);
  wowheadSessionPageUrl = listUrl;

  // Try fetch-based extraction first (no Puppeteer, less likely to be blocked)
  try {
    console.log(`  Fetching listview data from ${listUrl}...`);
    const html = await fetchListviewData(listUrl, browser);
    const { recipes } = parseListviewFromHtml(html, spellBaseUrl);
    scrapedRecipeItemDetails.clear();
    await enrichRecipeSources(recipes, browser, version, profession);
    const allRecipes = recipes.map((r) => ({ ...r, _version: version }));
    console.log(`  Fetched ${allRecipes.length} recipes from embedded HTML`);

    const versionDir = VERSION_TO_DIR[version];
    for (const recipe of allRecipes) {
      Object.keys(recipe.materials || {}).forEach((id) => {
        globalMaterialIds.add(id);
        globalMaterialData[id] = { name: '', quality: 1 };
        if (!globalMaterialDataByVersion[versionDir][id]) {
          globalMaterialDataByVersion[versionDir][id] = { name: '', quality: 1 };
        }
      });
    }
    return allRecipes;
  } catch (fetchErr) {
    if (fetchErr instanceof WowheadBlockedError) throw fetchErr;
    console.log(`  Fetch failed (${fetchErr.message}), falling back to Puppeteer...`);
  }

  // Fallback: Puppeteer-based scraping
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const allRecipes = [];

  try {
    let offset = 0;
    let pageCount = 1;
    let listviewSelector = '#lv-spells';

    const firstTimeUrl = `${listUrl}#0`;
    const maxLoadAttempts = 2;
    const waitStrategies = ['load', PAGE_LOAD_WAIT];  // 'load' waits for scripts; listview is rendered by JS
    for (let attempt = 1; attempt <= maxLoadAttempts; attempt++) {
      try {
        const waitUntil = waitStrategies[attempt - 1];
        console.log(`  Loading ${firstTimeUrl} (attempt ${attempt}/${maxLoadAttempts}, waitUntil: ${waitUntil})...`);
        await page.goto(firstTimeUrl, { waitUntil, timeout: 60000 });
        listviewSelector = await waitForAnySelector(page, LISTVIEW_SELECTORS);
        console.log(`  Found listview: ${listviewSelector}, waiting for content...`);
        await waitForListViewReady(page, listviewSelector);
        console.log(`  Listview ready`);
        break;
      } catch (err) {
        if (attempt === maxLoadAttempts) throw err;
        console.log(`  Load failed (${err.message}), retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    const number_of_recipes = await page.$eval(
        `${listviewSelector} > div.listview-band-top > div.listview-nav > span > b:nth-child(3)`,
        el => el.textContent.trim()
      );
      
    console.log("Number of Recipes:", number_of_recipes);

    // Create a reusable pool of pages for recipe detail scraping (avoids create/destroy per batch)
    const detailPagePool = await Promise.all(
      Array.from({ length: RECIPE_DETAIL_POOL_SIZE }, () => browser.newPage())
    );
    for (const p of detailPagePool) {
      await p.setViewport({ width: 1920, height: 1080 });
    }

    try {
    while (offset<number_of_recipes) {
        const paginatedUrl = `${listUrl}#${offset}`;
        console.log(`Scraping page ${pageCount} (${version}) → ${paginatedUrl}`);
        // Force full reload: hash-only changes often don't trigger reload, so we'd see same content.
        // Navigate away first to ensure each pagination gets a fresh load with correct hash.
        await page.goto('about:blank');
        if (offset > 0) await new Promise(r => setTimeout(r, 1500)); // Throttle pagination to avoid 403
        await page.goto(paginatedUrl, { waitUntil: PAGE_LOAD_WAIT, timeout: 90000 });
        await waitForListViewReady(page, listviewSelector);

        const recipes = await page.evaluate((sel) => {
          const rows = document.querySelectorAll(`${sel} tbody tr`);
        
          return Array.from(rows).map((row, index) => {
            // TBC uses different column layout (item first); find spell link anywhere in row
            const anchor = row.querySelector('a[href*="spell="]');
            if (!anchor) return null;
        
            const idMatch = anchor.href?.match(/spell=(\d+)/);
            const id = idMatch ? parseInt(idMatch[1]) : null;
            if (!id) return null;
        
            const name = anchor.textContent?.trim() ?? '';
            const qualityMatch = anchor.className.match(/q(\d)/);
            const quality = qualityMatch ? parseInt(qualityMatch[1]) : 1;
        
            // Difficulty: find span.r1 etc. anywhere in row (column index varies by version)
            const r1Span = row.querySelector('span.r1');
            const diffContainer = r1Span?.closest('div');
            const get = (cls) => {
              const span = diffContainer?.querySelector(`span.${cls}`);
              return span ? parseInt(span.textContent.trim()) : null;
            };
        
            const difficulty = {
              orange: get('r1'),
              yellow: get('r2'),
              green:  get('r3'),
              gray:   get('r4'),
            };
        
            const hasDifficulty = Object.values(difficulty).some(
              (v) => typeof v === 'number' && !isNaN(v)
            );
            if (!hasDifficulty) return null;
        
            // Icon: from spell cell or preceding cell (layout varies)
            const spellTd = anchor.closest('td');
            const iconIns = spellTd?.querySelector('ins') || spellTd?.previousElementSibling?.querySelector('ins') || row.querySelector('td ins');
            const iconUrl = iconIns?.style?.backgroundImage || '';
            const iconMatch = iconUrl.match(/\/icons\/.+\/(.+?)\.jpg/);
            const icon = iconMatch ? iconMatch[1] : '';
        
            // Materials: find reagent divs (contain item link + quantity); exclude first cell (product icon)
            const materials = {};
            const firstTd = row.querySelector('td');
            const allDivs = row.querySelectorAll('div');
            allDivs.forEach(div => {
              if (div.closest('td') === firstTd) return; // skip product cell
              const itemLink = div.querySelector('a[href*="item="]');
              if (!itemLink) return;
              const match = itemLink.href?.match(/item=(\d+)/);
              const itemId = match ? match[1] : null;
              const quantitySpan = div.querySelector('span');
              const quantity = quantitySpan ? parseInt(quantitySpan.textContent.trim()) : 1;
              if (itemId && quantity > 0) materials[itemId] = quantity;
            });
        
            const minSkill = difficulty.orange ?? null;
        
            return {
              id,
              name,
              quality,
              difficulty,
              materials,
              minSkill,
              icon,
              url: anchor.href
            };
          }).filter(r => r && r.id && r.name); // filter out nulls and incomplete recipes
        }, listviewSelector);


      console.log(`Found ${recipes.length} recipes on page ${pageCount}`);

      // Diagnostic when TBC/other version returns 0 recipes (different DOM structure)
      if (recipes.length === 0) {
        const diag = await page.evaluate((sel) => {
          const lv = document.querySelector(sel);
          const rows = lv?.querySelectorAll('tbody tr') || [];
          const anyTr = lv?.querySelectorAll('tr') || [];
          const firstRow = rows[0] || anyTr[0];
          return {
            hasLvSpells: !!lv,
            tbodyTrCount: rows.length,
            anyTrCount: anyTr.length,
            firstRowTds: firstRow ? firstRow.querySelectorAll('td').length : 0,
            firstRowHtml: firstRow ? firstRow.outerHTML.substring(0, 500) : null,
            listviewClasses: lv?.className || null,
          };
        }, listviewSelector);
        console.log(`DOM diagnostic (${version}):`, JSON.stringify(diag, null, 2));
      }

      // Process recipes in chunks using the shared page pool (reuse pages instead of create/destroy)
      for (let i = 0; i < recipes.length; i += RECIPE_DETAIL_POOL_SIZE) {
        if (i > 0) await new Promise(r => setTimeout(r, 2000)); // Throttle between chunks to avoid 403
        const chunk = recipes.slice(i, i + RECIPE_DETAIL_POOL_SIZE);
        await Promise.all(chunk.map(async (recipe, chunkIndex) => {
          const page = detailPagePool[chunkIndex];
          
          try {
            await page.goto(recipe.url, { waitUntil: 'domcontentloaded' });

            const isContentLoaded = async () => {
              const content = await page.evaluate(() => {
                // First check if either tab exists
                const trainerTab = document.querySelector('#tab-taught-by-npc');
                const itemTab = document.querySelector('#tab-taught-by-item');
                
                // If neither exists, we can stop waiting
                if (!trainerTab && !itemTab) {
                  return true;
                }
                
                // If tabs exist, check for their content
                const trainerContent = trainerTab?.querySelector('.listview-scroller-horizontal');
                const itemContent = itemTab?.querySelector('.listview-scroller-horizontal');
                return !!(trainerContent || itemContent);
              });
              return content;
            };

            let attempts = 0;
            const maxAttempts = 10;
            while (attempts < maxAttempts) {
              if (await isContentLoaded()) {
                break;
              }
              
              await page.evaluate(() => {
                const taughtByTab = document.querySelector('a[href="#taught-by"]');
                if (taughtByTab) taughtByTab.click();
              });
              
              await new Promise(resolve => setTimeout(resolve, 2000));
              attempts++;
            }

            const { produces, source } = await page.evaluate(({recipeName, recipeId}) => {
              console.log('Starting page evaluation');
              
              // First find the produced item information
              const producesAnchor = document.querySelector('#infobox-contents-0 a[href*="item="]');
              let produces = null;
              if (producesAnchor) {
                const href = producesAnchor.getAttribute('href');
                const match = href?.match(/item=(\d+)/);
                const id = match ? parseInt(match[1]) : null;
                const name = producesAnchor.textContent?.trim();
        
                if (id && name) {
                  produces = {
                    id,
                    name,
                    quantity: 1,
                  };
                }
              }

              // Check if either tab exists first
              const trainerTab = document.querySelector('#tab-taught-by-npc');
              const itemTab = document.querySelector('#tab-taught-by-item');
              
              // If neither tab exists, it's a free recipe
              if (!trainerTab && !itemTab) {
                return { 
                  produces,
                  source: { type: 'free' }
                };
              }

              // Log the entire tab content first
              const taughtByItemTab = document.querySelector('#tab-taught-by-item');
              console.log('Taught by Item Tab Content:', taughtByItemTab ? {
                visible: window.getComputedStyle(taughtByItemTab).display !== 'none',
                html: taughtByItemTab.innerHTML
              } : 'Tab not found');

              // Try multiple selectors to find the recipe item
              const selectors = [
                '#tab-taught-by-item > div.listview-scroller-horizontal > div > table > tbody > tr > td:nth-child(3) > div > a',
                '#tab-taught-by-item table td a[href*="item="]',
                '#tab-taught-by-item a[href*="item="]'
              ];

              let recipeItemLink = null;
              for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                  recipeItemLink = element;
                  break;
                }
              }
              
              if (recipeItemLink) {
                const itemMatch = recipeItemLink.href.match(/item=(\d+)/);
                const itemName = recipeItemLink.textContent.trim();
                
                if (itemMatch) {
                  source = {
                    type: 'item',
                    recipeItemId: parseInt(itemMatch[1]),
                    recipeItemName: itemName
                  };
                }
              } else {
                // Check for trainer cost by finding the div with data-markup-content-target="1" containing "Training cost:"
                let trainerCost = 0;
                
                // Find the specific div with data-markup-content-target="1" that contains "Training cost:"
                let trainingCostDiv = null;
                
                // First try to find divs with the data attribute
                const divsWithAttribute = document.querySelectorAll('div[data-markup-content-target="1"]');
                for (const div of divsWithAttribute) {
                  const text = div.textContent || '';
                  if (text.includes('Training cost:')) {
                    trainingCostDiv = div;
                    break;
                  }
                }
                
                // If not found, fall back to searching for any div containing "Training cost:"
                if (!trainingCostDiv) {
                  const allDivs = document.querySelectorAll('div');
                  for (const div of allDivs) {
                    const text = div.textContent || '';
                    if (text.includes('Training cost:')) {
                      trainingCostDiv = div;
                      break;
                    }
                  }
                }
                
                if (trainingCostDiv) {
                  // Find all money spans within this div only (not nested deeper)
                  const moneySpans = trainingCostDiv.querySelectorAll('span.moneygold, span.moneysilver, span.moneycopper');
                  
                  moneySpans.forEach(moneySpan => {
                    const text = moneySpan.textContent.trim();
                    // Extract only digits from the text
                    const amount = parseInt(text.replace(/[^\d]/g, ''), 10);
                    
                    if (!isNaN(amount) && amount > 0) {
                      if (moneySpan.classList.contains('moneygold')) {
                        trainerCost += amount * 10000;
                      } else if (moneySpan.classList.contains('moneysilver')) {
                        trainerCost += amount * 100;
                      } else if (moneySpan.classList.contains('moneycopper')) {
                        trainerCost += amount;
                      }
                    }
                  });
                  
                  // Debug logging for recipe 3452 (Mana Potion) to see what's being parsed
                  if (recipeId === 3452) {
                    console.log(`[${recipeId}] Training cost parsing:`, {
                      divHTML: trainingCostDiv.innerHTML,
                      divText: trainingCostDiv.textContent,
                      moneySpansFound: moneySpans.length,
                      spans: Array.from(moneySpans).map(s => ({ text: s.textContent, class: s.className })),
                      totalCost: trainerCost
                    });
                  }
                  
                  // Debug logging
                  if (moneySpans.length === 0) {
                    console.log(`[${recipeId}] Found "Training cost:" div but no money spans. Div HTML: "${trainingCostDiv.innerHTML}"`);
                  }
                } else {
                  console.log(`[${recipeId}] Could not find div containing "Training cost:" text`);
                }

                // Get all trainers
                const trainerRows = document.querySelectorAll('#tab-taught-by-npc > div.listview-scroller-horizontal > div > table > tbody > tr');
                const trainers = [];
                
                trainerRows.forEach(row => {
                  const trainerLink = row.querySelector('td:nth-child(1) > a');
                  if (trainerLink) {
                    const npcMatch = trainerLink.href.match(/npc=(\d+)/);
                    if (npcMatch) {
                      trainers.push({
                        id: parseInt(npcMatch[1]),
                        name: trainerLink.textContent.trim()
                      });
                    }
                  }
                });

                if (trainers.length > 0) {
                  source = {
                    type: 'trainer',
                    cost: trainerCost,
                    trainers: trainers
                  };
                } else {
                  // If no trainer and no recipe item found, mark as free
                  source = {
                    type: 'free'
                  };
                }
              }

              return { produces, source };
            }, { recipeName: recipe.name, recipeId: recipe.id });
          
            if (produces) {
              recipe.produces = produces;
              console.log(`[${recipe.id}] Produces item ${produces.id} (${produces.name})`);
            }

            if (source) {
              recipe.source = source;
              console.log(`[${recipe.id}] Source: ${source.type}${source.type === 'trainer' ? ` (${source.cost}c)` : ''}${source.type === 'item' ? ` [Item: ${source.recipeItemId}]` : ''}`);
            }
          } catch (err) {
            console.error(`[${recipe.id}] Error:`, err.message);
          }
        }));
      }

      allRecipes.push(...recipes.map(r => ({ ...r, _version: version })));

      const versionDir = VERSION_TO_DIR[version];
      for (const recipe of recipes) {
        Object.keys(recipe.materials).forEach(id => {
          globalMaterialIds.add(id);
          globalMaterialData[id] = { name: '', quality: 1 };
          if (!globalMaterialDataByVersion[versionDir][id]) {
            globalMaterialDataByVersion[versionDir][id] = { name: '', quality: 1 };
          }
        });
      }


      pageCount++;
      offset += 50;
    }

    return allRecipes;
    } finally {
      console.log(`Closing ${detailPagePool.length} reusable detail pages...`);
      await Promise.all(detailPagePool.map(p => p.close()));
    }
  } catch (err) {
    if (err instanceof WowheadBlockedError) throw err;
    console.error(`Error scraping ${profession} (${version}):`, err.message);
    return [];
  } finally {
    await page.close();
  }
};

/** Strip _version and flatten for saving (no versioned structure) */
const toFlatRecipe = (r) => {
  const { _version, ...flat } = r;
  if (flat.source?._needsRecipeItem) {
    const { _needsRecipeItem, ...source } = flat.source;
    flat.source = source.recipeItemId ? source : { type: 'free' };
  }
  return flat;
};

/** Scrape a profession for applicable versions; save each version to its own directory */
const scrapeProfession = async (browser, profession) => {
  const versionsToScrape = (requestedVersion
    ? [requestedVersion]
    : GAME_VERSIONS
  ).filter(v => {
    if (TBC_ONLY_PROFESSIONS.includes(profession) && v !== 'The Burning Crusade') return false;
    return true;
  });

  for (const version of versionsToScrape) {
    const recipes = await scrapeProfessionForVersion(browser, profession, version);
    const flatRecipes = recipes.map(toFlatRecipe);
    const versionDir = VERSION_TO_DIR[version];
    const outputDir = path.join(__dirname, '..', 'data', 'recipes', versionDir);
    const outputPath = path.join(outputDir, `${profession}.json`);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(flatRecipes, null, 2));

    console.log(`Saved ${flatRecipes.length} recipes (${version}) → ${outputPath}`);
    await processRecipeItems(profession, flatRecipes, browser, versionDir);
    const checkpointPath = path.join(__dirname, '..', 'data', '.wowhead-cache', 'sources', `${versionDir}-${profession}.json`);
    await fs.unlink(checkpointPath).catch(() => {});
  }
};

const WOWHEAD_VERSION_PATH = { vanilla: 'classic', tbc: 'tbc', forever: 'forever' };
const ENRICH_CONCURRENCY = 500; // Parallel XML fetches per batch

/** Recipe items bought with a token, such as Merchant's Favor, are recorded during enrichment. */
async function enrichRecipeCurrencyCosts(browser, versionDir) {
  const wowheadPath = WOWHEAD_VERSION_PATH[versionDir] || 'classic';
  const professionsToProcess = (requestedProfession ? [requestedProfession] : PROFESSIONS)
    .filter((profession) => versionDir === 'tbc' || !TBC_ONLY_PROFESSIONS.includes(profession));
  console.log(`[${versionDir}] Enriching recipe item currency costs...`);

  for (const profession of professionsToProcess) {
    const outputPath = path.join(__dirname, '..', 'data', 'recipes', versionDir, `${profession}_items.json`);
    let recipeItems;
    try {
      recipeItems = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    } catch {
      continue;
    }
    const itemIds = Object.keys(recipeItems);
    if (!itemIds.length) continue;

    const updates = await mapWithConcurrency(itemIds, RECIPE_ITEM_FETCH_CONCURRENCY, async (itemId) => {
      const html = await fetchWowheadText(
        `https://www.wowhead.com/${wowheadPath}/item=${itemId}`,
        wowheadHtmlHeaders,
        browser
      );
      return {
        itemId,
        currencyCost: await namedCurrencyCosts(html, wowheadPath, browser),
        faction: questFactionExclusive(html),
      };
    });

    let changed = 0;
    for (const update of updates) {
      const item = recipeItems[update.itemId];
      let itemChanged = false;
      const previous = JSON.stringify(item.currencyCost || []);
      const next = JSON.stringify(update.currencyCost);
      if (previous !== next) {
        if (update.currencyCost.length) item.currencyCost = update.currencyCost;
        else delete item.currencyCost;
        itemChanged = true;
      }
      const nextFaction = update.faction || undefined;
      if ((item.faction || undefined) !== nextFaction) {
        if (nextFaction) item.faction = nextFaction;
        else delete item.faction;
        itemChanged = true;
      }
      if (itemChanged) changed += 1;
    }
    if (changed) await fs.writeFile(outputPath, JSON.stringify(recipeItems, null, 2) + '\n');
    const alliance = Object.values(recipeItems).filter((item) => item.faction === 'Alliance').length;
    const horde = Object.values(recipeItems).filter((item) => item.faction === 'Horde').length;
    console.log(`[${versionDir}] ${profession}: ${changed} recipe items updated (${alliance} Alliance, ${horde} Horde quest recipes)`);
  }
}

const enrichMaterialData = async (browser) => {
    const materialsBaseDir = path.join(__dirname, '..', 'data', 'materials');
    const recipesDir = path.join(__dirname, '..', 'data', 'recipes');

    const versionDirsToEnrich = requestedVersion
      ? [VERSION_TO_DIR[requestedVersion]]
      : Object.values(VERSION_TO_DIR);
    console.log(`Enrichment: ${requestedVersion ? requestedVersion : 'all versions'}`);

    for (const versionDir of versionDirsToEnrich) {
      const materialPath = path.join(materialsBaseDir, versionDir, 'materials.json');
      const wowheadPath = WOWHEAD_VERSION_PATH[versionDir];
      let materials = {};

      try {
        const raw = await fs.readFile(materialPath, 'utf-8');
        materials = JSON.parse(raw);
        console.log(`[${versionDir}] Loaded ${Object.keys(materials).length} materials`);
      } catch (err) {
        const versionRecipesDir = path.join(recipesDir, versionDir);
        try {
          const files = await fs.readdir(versionRecipesDir);
          const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('_items'));
          for (const file of jsonFiles) {
            const recipes = JSON.parse(await fs.readFile(path.join(versionRecipesDir, file), 'utf-8'));
            recipes.forEach(recipe => {
              Object.keys(recipe.materials || {}).forEach(id => {
                if (!materials[id]) materials[id] = { name: '', quality: 1 };
              });
            });
          }
          await fs.mkdir(path.dirname(materialPath), { recursive: true });
          await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
          console.log(`[${versionDir}] Rebuilt ${Object.keys(materials).length} materials from recipes`);
        } catch (rebuildErr) {
          console.warn(`[${versionDir}] No recipes, skipping enrichment`);
          continue;
        }
      }

      const materialIds = Object.keys(materials).filter(id => {
        const mat = materials[id];
        return !mat.name || mat.name === '' || mat.name.trim() === '';
      });
      console.log(`[${versionDir}] Enriching ${materialIds.length} materials (${wowheadPath} URL)...`);

      if (materialIds.length === 0) {
        console.log(`[${versionDir}] Materials already enriched.`);
      }

    try {
    // Fetch XML in parallel batches
    const fetchOneXml = async (id) => {
      const url = `https://www.wowhead.com/${wowheadPath}/item=${id}&xml`;
      try {
        const xml = await fetchWowheadText(url, wowheadXmlHeaders, browser);
        const parsed = await parseStringPromise(xml);
        const item = parsed?.wowhead?.item?.[0];
        const name = item?.name?.[0];
        const quality = parseInt(item?.quality?.[0]?.$?.id || 1);
        const itemClass = item?.class?.[0]?._?.trim() || '';
        const classId = item?.class?.[0]?.$?.id ? String(item.class[0].$.id) : '';
        const subclass = item?.subclass?.[0]?._?.trim() || '';
        const slot = item?.inventorySlot?.[0]?._?.trim() || '';
        const itemLevel = itemLevelFromXmlItem(item);
        const link = item?.link?.[0]?.trim() || '';
        let vendorPrice = null;
        let sellPrice = null;
        const jsonEquipStr = item?.jsonEquip?.[0];
        if (typeof jsonEquipStr === 'string') {
          try {
            const json = JSON.parse(`{${jsonEquipStr}}`);
            vendorPrice = json.buyprice ?? null;
            if (json.sellprice != null && json.sellprice !== '') {
              const parsedSell = Number(json.sellprice);
              if (Number.isFinite(parsedSell)) sellPrice = parsedSell;
            }
          } catch {}
        }
        let icon = '';
        const iconNode = item?.icon?.[0];
        if (typeof iconNode === 'string') icon = iconNode.trim();
        else if (typeof iconNode === 'object' && iconNode._) icon = iconNode._.trim();
        let createdBy = null;
        const spell = item?.createdBy?.[0]?.spell?.[0];
        if (spell) {
          const spellId = parseInt(spell.$?.id ?? '0');
          const spellName = spell.$?.name ?? '';
          const minCount = parseInt(spell.$?.minCount ?? '1');
          const maxCount = parseInt(spell.$?.maxCount ?? '1');
          const reagents = {};
          for (const reagent of spell.reagent ?? []) {
            const rid = parseInt(reagent.$?.id ?? '0');
            const count = parseInt(reagent.$?.count ?? '1');
            if (rid > 0 && !isNaN(count)) reagents[rid] = count;
          }
          if (spellId && Object.keys(reagents).length > 0) {
            createdBy = { spellId, spellName, reagents, minCount, maxCount };
          }
        }
        return { id, name, quality, itemClass, classId, subclass, icon, slot, link, vendorPrice, sellPrice, createdBy, itemLevel };
      } catch (err) {
        if (err instanceof WowheadBlockedError) throw err;
        console.warn(`Error fetching item ${id}: ${err.message}`);
        return { id, error: err.message };
      }
    };

    for (let i = 0; i < materialIds.length; i += ENRICH_CONCURRENCY) {
      const batch = materialIds.slice(i, i + ENRICH_CONCURRENCY);
      const batchNum = Math.floor(i / ENRICH_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(materialIds.length / ENRICH_CONCURRENCY);
      console.log(`  [${versionDir}] Batch ${batchNum}/${totalBatches} (${batch.length} items)...`);
      const results = await Promise.all(batch.map(id => fetchOneXml(id)));
      const vendorInfoById = new Map();
      await Promise.all(results.map(async (r) => {
        if (r.error || r.vendorPrice == null || !r.name || !r.name.trim()) return;
        try {
          const itemUrl = `https://www.wowhead.com/${wowheadPath}/item=${r.id}`;
          const html = await fetchWowheadText(itemUrl, wowheadHtmlHeaders, browser);
          vendorInfoById.set(r.id, parseSoldByFromHtml(html));
        } catch (err) {
          if (err instanceof WowheadBlockedError) throw err;
          console.warn(`Limited stock check failed for ${r.id}: ${err.message}`);
          vendorInfoById.set(r.id, { failed: true });
        }
      }));
      for (const r of results) {
        if (r.error) continue;
        const { id, name, quality, itemClass, subclass, icon, slot, link, vendorPrice, sellPrice, createdBy, itemLevel } = r;
        if (!name || name.trim() === '') {
          console.warn(`    No name found for item ${id}, skipping`);
          continue;
        }
        let price = vendorPrice;
        let limitedStock = false;
        const vendorInfo = vendorInfoById.get(id);
        if (vendorInfo && !vendorInfo.failed) {
          if (!vendorInfo.hasCurrencyPrice) price = null;
          else limitedStock = vendorInfo.limitedStock;
        }
        materials[id] = {
          name,
          quality,
          class: itemClass,
          subclass,
          icon,
          slot,
          link,
          vendorPrice: price,
          ...(typeof sellPrice === 'number' ? { sellPrice } : {}),
          ...(limitedStock ? { limitedStock: true } : {}),
          ...(createdBy ? { createdBy } : {}),
          ...(itemLevel != null ? { itemLevel } : {}),
        };
        console.log(`    Enriched item ${id}: ${name}`);
      }
      await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
      if (i + ENRICH_CONCURRENCY < materialIds.length) {
        await new Promise(r => setTimeout(r, 300)); // Brief pause between batches
      }
    }
    console.log(`Processed ${materialIds.length} materials`);
  
    await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
    console.log(`[${versionDir}] Enrichment complete → ${materialPath}`);

    const producedIds = new Set();
    const professionsForItemLevel = (requestedProfession ? [requestedProfession] : PROFESSIONS)
      .filter((profession) => versionDir === 'tbc' || !TBC_ONLY_PROFESSIONS.includes(profession));
    for (const profession of professionsForItemLevel) {
      const recipePath = path.join(recipesDir, versionDir, `${profession}.json`);
      let recipes;
      try {
        recipes = JSON.parse(await fs.readFile(recipePath, 'utf8'));
      } catch {
        continue;
      }
      for (const recipe of recipes) {
        const producedId = recipe.produces?.id;
        if (!producedId) continue;
        const existing = materials[String(producedId)];
        const hasLevel = typeof existing?.itemLevel === 'number' && !Number.isNaN(existing.itemLevel);
        const hasSell = typeof existing?.sellPrice === 'number';
        if (hasLevel && hasSell) continue;
        producedIds.add(String(producedId));
      }
    }
    const producedList = [...producedIds];
    console.log(`[${versionDir}] Recording item level and vendor sell price for ${producedList.length} crafted items...`);
    let craftedStatsRecorded = 0;
    for (let i = 0; i < producedList.length; i += ENRICH_CONCURRENCY) {
      const batch = producedList.slice(i, i + ENRICH_CONCURRENCY);
      const batchNum = Math.floor(i / ENRICH_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(producedList.length / ENRICH_CONCURRENCY);
      console.log(`  [${versionDir}] Crafted item batch ${batchNum}/${totalBatches} (${batch.length} items)...`);
      const results = await Promise.all(batch.map((id) => fetchOneXml(id)));
      for (const result of results) {
        if (result.error) continue;
        const sellPrice = typeof result.sellPrice === 'number' ? result.sellPrice : 0;
        const existing = materials[result.id];
        if (existing) {
          let wrote = false;
          if (result.itemLevel != null && typeof existing.itemLevel !== 'number') {
            existing.itemLevel = result.itemLevel;
            wrote = true;
          }
          if (typeof existing.sellPrice !== 'number') {
            existing.sellPrice = sellPrice;
            wrote = true;
          }
          if (!wrote && result.itemLevel == null) console.warn(`    No item level for item ${result.id}`);
          if (wrote) craftedStatsRecorded += 1;
        } else if (result.name && result.name.trim()) {
          materials[result.id] = {
            name: result.name,
            quality: result.quality,
            class: result.classId || '',
            subclass: result.subclass,
            icon: result.icon,
            slot: result.slot,
            link: result.link,
            vendorPrice: result.vendorPrice,
            sellPrice,
            ...(result.itemLevel != null ? { itemLevel: result.itemLevel } : {}),
          };
          craftedStatsRecorded += 1;
        } else {
          console.warn(`    No name found for item ${result.id}, skipping`);
        }
      }
      await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
    }
    console.log(`[${versionDir}] Recorded item level or vendor sell price on ${craftedStatsRecorded} crafted items`);

    await enrichRecipeCurrencyCosts(browser, versionDir);
      } catch (err) {
        if (err instanceof WowheadBlockedError) throw err;
        console.error(`[${versionDir}] Enrichment failed: ${err.message}`);
      }
    }
  };


  const downloadMaterialIcons = async () => {
    const materialsBaseDir = path.join(__dirname, '..', 'data', 'materials');
    const projectRoot = path.join(__dirname, '..', '..');
    const iconDir = path.join(projectRoot, 'public', 'icons', 'materials');
    await fs.mkdir(iconDir, { recursive: true });

    const allMaterials = {};
    for (const versionDir of Object.values(VERSION_TO_DIR)) {
      try {
        const raw = await fs.readFile(path.join(materialsBaseDir, versionDir, 'materials.json'), 'utf-8');
        Object.assign(allMaterials, JSON.parse(raw));
      } catch {
        try {
          Object.assign(allMaterials, JSON.parse(await fs.readFile(path.join(materialsBaseDir, 'materials.json'), 'utf-8')));
          break;
        } catch { /* legacy path */ }
      }
    }
    const materials = allMaterials;
  
    for (const [id, material] of Object.entries(materials)) {
      if (!material.icon) continue;

      const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/${material.icon}.jpg`;
      const targetPath = path.join(iconDir, `${id}.jpg`);
      try {
        await fs.access(targetPath);
        continue;
      } catch { /* download missing files only */ }
  
      try {
        const response = await fetch(iconUrl, { headers: { 'User-Agent': WOWHEAD_USER_AGENT }, redirect: 'follow' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await streamPipeline(response.body, createWriteStream(targetPath));
        console.log(`Saved material icon ${id} → ${material.icon}.jpg`);
      } catch (err) {
        console.warn(`Failed to download icon for material ${id}: ${err.message}`);
      }
    }
  };

  const downloadRecipeIcons = async (profession, versionDir) => {
    const recipePath = path.join(__dirname, '..', 'data', 'recipes', versionDir, `${profession}.json`);
    try {
      await fs.access(recipePath);
    } catch {
      return; // skip if file doesn't exist
    }
    const projectRoot = path.join(__dirname, '..', '..');
    const iconDir = path.join(projectRoot, 'public', 'icons', profession);
    await fs.mkdir(iconDir, { recursive: true });
  
    const recipes = JSON.parse(await fs.readFile(recipePath, 'utf-8'));
  
    const pending = [];
    for (const recipe of recipes) {
      const icon = recipe.icon;
      const id = recipe.id;
      if (!icon) continue;
      const targetPath = path.join(iconDir, `${id}.jpg`);
      try {
        await fs.access(targetPath);
      } catch {
        pending.push({ id, icon, targetPath });
      }
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const job = pending[cursor++];
        const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/${job.icon}.jpg`;
        try {
          const response = await fetch(iconUrl, { headers: { 'User-Agent': WOWHEAD_USER_AGENT }, redirect: 'follow' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await streamPipeline(response.body, createWriteStream(job.targetPath));
          console.log(`Saved recipe icon ${job.id} → ${job.icon}.jpg`);
        } catch (err) {
          console.warn(`Failed to download icon for recipe ${job.id}: ${err.message}`);
        }
      }
    };
    const workers = Math.min(12, pending.length);
    if (workers > 0) {
      console.log(`Downloading ${pending.length} missing ${profession} icons...`);
      await Promise.all(Array.from({ length: workers }, () => worker()));
    }
  };

  /** Forever list pages publish icons as addData(6, 16). Fill blank recipe and material icons from that data. */
  const backfillMissingIcons = async (browser, versionDirs) => {
    const professionsToProcess = requestedProfession ? [requestedProfession] : PROFESSIONS;
    for (const versionDir of versionDirs) {
      const version = Object.entries(VERSION_TO_DIR).find(([, dir]) => dir === versionDir)?.[0];
      if (!version) continue;
      const materialPath = path.join(__dirname, '..', 'data', 'materials', versionDir, 'materials.json');
      let materials = null;
      try {
        materials = JSON.parse(await fs.readFile(materialPath, 'utf-8'));
      } catch { /* no materials file for this version */ }
      let materialsChanged = 0;

      for (const profession of professionsToProcess) {
        if (versionDir !== 'tbc' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;
        const recipePath = path.join(__dirname, '..', 'data', 'recipes', versionDir, `${profession}.json`);
        let recipes;
        try {
          recipes = JSON.parse(await fs.readFile(recipePath, 'utf-8'));
        } catch {
          continue;
        }
        const needsRecipeIcon = recipes.some((recipe) => !recipe.icon);
        const needsMaterialIcon = materials && Object.values(materials).some((material) => !material.icon);
        if (!needsRecipeIcon && !needsMaterialIcon) continue;

        const listUrl = getProfessionListUrl(version, profession);
        console.log(`Reading icons from ${profession} (${version})...`);
        const html = await fetchListviewData(listUrl, browser);
        const spellIcons = readGathererData(html, 6);
        let filled = 0;
        for (const recipe of recipes) {
          if (recipe.icon) continue;
          const icon = spellIcons[String(recipe.id)]?.icon;
          if (!icon) continue;
          recipe.icon = icon;
          filled++;
        }
        if (filled) await fs.writeFile(recipePath, JSON.stringify(recipes, null, 2));
        console.log(`  ${profession}: filled ${filled} recipe icons`);

        if (materials) {
          const itemIcons = readGathererData(html, 3);
          for (const [id, info] of Object.entries(itemIcons)) {
            if (!info?.icon || !materials[id] || materials[id].icon) continue;
            materials[id].icon = info.icon;
            materialsChanged++;
          }
        }
      }

      if (materialsChanged && materials) {
        await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
        console.log(`Filled ${materialsChanged} material icons (${versionDir})`);
      }
    }
  };

const processRecipeItems = async (profession, recipes, browser, versionDir) => {
  console.log(`\nProcessing recipe items for ${profession} (${versionDir})...`);
  
  const recipeItems = {};
  
  // Use version-specific WoWhead path (TBC items may not exist on classic endpoint)
  const wowheadPath = WOWHEAD_VERSION_PATH[versionDir] || 'classic';
  
  try {
    // Get all unique recipe item IDs (flat format)
    const recipeItemIds = new Set();
    recipes.forEach(recipe => {
      if (recipe.source?.type === 'item') recipeItemIds.add(recipe.source.recipeItemId);
    });
    
    const itemIds = Array.from(recipeItemIds);
    console.log(`Found ${itemIds.length} unique recipe items to process`);

    // Process all items in parallel
    console.log('Fetching XML data for all items...');
    const results = await mapWithConcurrency(itemIds, RECIPE_ITEM_FETCH_CONCURRENCY, async (itemId) => {
      const cached = scrapedRecipeItemDetails.get(itemId);
      if (cached) return { itemId, data: cached };
      try {
        // Fetch XML data (use version-specific URL - TBC items need tbc endpoint)
        const parseXml = async (xmlText) => {
          const parsed = await parseStringPromise(xmlText);
          const item = parsed?.wowhead?.item?.[0];
          const htmlTooltip = item?.htmlTooltip?.[0] || '';
          const firstTable = htmlTooltip.split('</table>')[0];
          const isRecipeBoP = firstTable.includes('Binds when picked up');
          const jsonEquipStr = item?.jsonEquip?.[0];
          let buyPrice = null;
          if (typeof jsonEquipStr === 'string') {
            try {
              const json = JSON.parse(`{${jsonEquipStr}}`);
              buyPrice = json.buyprice ?? null;
            } catch (e) {
              console.warn(`Failed to parse jsonEquip for item ${itemId}`);
            }
          }
          const nameNode = item?.name?.[0];
          const name = typeof nameNode === 'string' ? nameNode.trim() : (nameNode?._?.trim() || '');
          const quality = parseInt(item?.quality?.[0]?.$?.id || 1);
          let icon = '';
          const iconNode = item?.icon?.[0];
          if (typeof iconNode === 'string') icon = iconNode.trim();
          else if (typeof iconNode === 'object' && iconNode._) icon = iconNode._.trim();
          return { bop: isRecipeBoP, buyPrice, name, quality: Number.isNaN(quality) ? 1 : quality, icon };
        };

        let xmlData;
        try {
          const xmlUrl = `https://www.wowhead.com/${wowheadPath}/item=${itemId}&xml`;
          const xmlText = await fetchWowheadText(xmlUrl, wowheadXmlHeaders, browser);
          xmlData = await parseXml(xmlText);
        } catch (primaryErr) {
          // Classic and TBC share some recipe item ids. Forever stays on its own pages.
          const fallbackPath = wowheadPath === 'classic' ? 'tbc' : wowheadPath === 'tbc' ? 'classic' : null;
          if (!fallbackPath) throw primaryErr;
          try {
            const fallbackUrl = `https://www.wowhead.com/${fallbackPath}/item=${itemId}&xml`;
            const xmlText = await fetchWowheadText(fallbackUrl, wowheadXmlHeaders, browser);
            xmlData = await parseXml(xmlText);
          } catch {
            throw primaryErr;
          }
        }

        // Fetch HTML data for limited stock info (parses sold-by Listview, no scripts required)
        const htmlUrl = `https://www.wowhead.com/${wowheadPath}/item=${itemId}`;
        const htmlData = await fetchWowheadText(htmlUrl, wowheadHtmlHeaders, browser)
          .then(async (html) => ({
            limitedStock: parseLimitedStockFromHtml(html),
            hasSource: itemHasAcquisitionSource(html),
            mobDrop: xmlData.bop && !xmlData.buyPrice && itemIsBopMobDrop(html),
            currencyCost: await namedCurrencyCosts(html, wowheadPath, browser),
            faction: questFactionExclusive(html),
          }))
          .catch(err => {
            if (err instanceof WowheadBlockedError) throw err;
            console.error(`HTML fetch error for item ${itemId}:`, err.message);
            return { limitedStock: false, hasSource: undefined };
          });

        return {
          itemId,
          data: {
            bop: xmlData.bop,
            limitedStock: htmlData.limitedStock,
            buyPrice: xmlData.buyPrice,
            auctionhouse: !xmlData.bop && !htmlData.limitedStock && !xmlData.buyPrice,
            name: xmlData.name || undefined,
            quality: xmlData.quality,
            icon: xmlData.icon || undefined,
            ...(typeof htmlData.hasSource === 'boolean' ? { hasSource: htmlData.hasSource } : {}),
            ...(typeof htmlData.mobDrop === 'boolean' ? { mobDrop: htmlData.mobDrop } : {}),
            ...(htmlData.currencyCost?.length ? { currencyCost: htmlData.currencyCost } : {}),
            ...(htmlData.faction ? { faction: htmlData.faction } : {}),
          }
        };

      } catch (err) {
        if (err instanceof WowheadBlockedError) throw err;
        console.error(`Error processing item ${itemId}:`, err.message);
        return { itemId, data: null };
      }
    });

    // Record all results
    results.forEach(result => {
      if (result.data) {
        recipeItems[result.itemId] = result.data;
      }
    });
    
    // Save the data to version-specific directory
    const outputDir = path.join(__dirname, '..', 'data', 'recipes', versionDir);
    const outputPath = path.join(outputDir, `${profession}_items.json`);
    
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(recipeItems, null, 2));
    
    console.log(`\nSaved ${Object.keys(recipeItems).length} recipe items → ${outputPath}`);
    await downloadRecipeItemIcons(recipeItems);
    
  } catch (err) {
    if (err instanceof WowheadBlockedError) throw err;
    console.error('Error processing recipe items:', err.message);
  }
  
  return recipeItems;
};

/** Save recipe-item icons beside the other material icons, named by item id. */
const downloadRecipeItemIcons = async (recipeItems) => {
  const projectRoot = path.join(__dirname, '..', '..');
  const iconDir = path.join(projectRoot, 'public', 'icons', 'materials');
  await fs.mkdir(iconDir, { recursive: true });
  const pending = [];
  for (const [id, item] of Object.entries(recipeItems)) {
    if (!item?.icon) continue;
    const targetPath = path.join(iconDir, `${id}.jpg`);
    try {
      await fs.access(targetPath);
    } catch {
      pending.push({ id, icon: item.icon, targetPath });
    }
  }
  if (pending.length === 0) return;
  console.log(`Downloading ${pending.length} recipe item icons...`);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const job = pending[cursor++];
      const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/${job.icon}.jpg`;
      try {
        const response = await fetch(iconUrl, { headers: { 'User-Agent': WOWHEAD_USER_AGENT }, redirect: 'follow' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await streamPipeline(response.body, createWriteStream(job.targetPath));
      } catch (err) {
        console.warn(`Failed to download icon for recipe item ${job.id}: ${err.message}`);
      }
    }
  };
  const workers = Math.min(32, pending.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  console.log(`Recipe item icons saved to ${iconDir}`);
};

(async () => {
  // When only zip phase is requested, run it standalone (no browser or materials needed)
  const onlyZip = phases.zip && !phases.scrape && !phases.enrich && !phases.downloadIcons && !phases.recipeItems;
  if (onlyZip) {
    console.log('Running zip phase only...\n');
    await zipIcons();
    console.log('\nZip phase complete!');
    process.exit(0);
  }

    const outputDirMaterials = path.join(__dirname, '..', 'data', 'materials');
    const materialPath = path.join(outputDirMaterials, 'materials.json');

    // Load existing materials (version-specific or legacy single file)
    const versionDirsToProcess = requestedVersion
      ? [VERSION_TO_DIR[requestedVersion]]
      : Object.values(VERSION_TO_DIR);
    let loadedFromLegacy = false;
    for (const versionDir of versionDirsToProcess) {
      const versionPath = path.join(outputDirMaterials, versionDir, 'materials.json');
      try {
        const existing = await fs.readFile(versionPath, 'utf-8');
        const parsed = JSON.parse(existing);
        globalMaterialDataByVersion[versionDir] = parsed;
        for (const id in parsed) {
          globalMaterialIds.add(id);
          globalMaterialData[id] = parsed[id];
        }
        console.log(`Loaded ${Object.keys(parsed).length} materials from ${versionDir}/materials.json`);
      } catch {
        if (!loadedFromLegacy) {
          try {
            const existing = await fs.readFile(materialPath, 'utf-8');
            const parsed = JSON.parse(existing);
            for (const vd of versionDirsToProcess) {
              globalMaterialDataByVersion[vd] = { ...parsed };
            }
            for (const id in parsed) {
              globalMaterialIds.add(id);
              globalMaterialData[id] = parsed[id];
            }
            console.log(`Loaded ${Object.keys(parsed).length} materials from legacy materials.json`);
            loadedFromLegacy = true;
          } catch {
            console.log(`No existing materials found, starting fresh.`);
          }
        }
      }
    }


  const browser = await puppeteer.launch({
    headless: runHeaded ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Phase 1: Scrape professions
  if (phases.scrape) {
    if (requestedProfession) {
      if (!PROFESSIONS.includes(requestedProfession)) {
        console.error(`Invalid profession: ${requestedProfession}`);
        console.log(`Valid options: ${PROFESSIONS.join(', ')}`);
        await browser.close();
        process.exit(1);
      }
      await scrapeProfession(browser, requestedProfession);
    } else {
      for (const profession of PROFESSIONS) {
        await scrapeProfession(browser, profession);
      }
      console.log(`\nAll professions scraped successfully.`);
    }
    
    // Merge into the file on disk so parallel profession runs keep each other's new ids.
    await fs.mkdir(outputDirMaterials, { recursive: true });
    for (const versionDir of versionDirsToProcess) {
      const data = globalMaterialDataByVersion[versionDir] || {};
      const versionPath = path.join(outputDirMaterials, versionDir, 'materials.json');
      await fs.mkdir(path.dirname(versionPath), { recursive: true });
      const lockPath = `${versionPath}.lock`;
      let locked = false;
      for (let attempt = 0; attempt < 40 && !locked; attempt++) {
        try {
          await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
          locked = true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 25));
        }
      }
      if (!locked) throw new Error(`Could not lock ${versionPath}`);
      try {
        let current = {};
        try {
          current = JSON.parse(await fs.readFile(versionPath, 'utf8'));
        } catch {
          current = {};
        }
        for (const [id, value] of Object.entries(data)) {
          if (!current[id] || (!current[id].name && value?.name)) current[id] = value;
        }
        await fs.writeFile(versionPath, JSON.stringify(current, null, 2));
        console.log(`Saved ${Object.keys(current).length} materials (${versionDir}) → ${versionPath}`);
      } finally {
        await fs.unlink(lockPath).catch(() => {});
      }
    }
  } else {
    console.log(`Skipping scrape phase`);
  }

  if (phases.recipeItems) {
    const professionsToProcess = requestedProfession ? [requestedProfession] : PROFESSIONS;
    for (const versionDir of versionDirsToProcess) {
      for (const profession of professionsToProcess) {
        if (versionDir !== 'tbc' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;
        const recipePath = path.join(__dirname, '..', 'data', 'recipes', versionDir, `${profession}.json`);
        let recipes;
        try {
          recipes = JSON.parse(await fs.readFile(recipePath, 'utf8'));
        } catch {
          continue;
        }
        await processRecipeItems(profession, recipes, browser, versionDir);
      }
    }
  }

  // Phase 2: Enrich material data
  if (phases.enrich) {
    console.log(`\nStarting material enrichment phase...`);
    await enrichMaterialData(browser);
  } else {
    console.log(`Skipping enrichment phase`);
  }

  // Phase 3: Download icons
  if (phases.downloadIcons) {
    await backfillMissingIcons(browser, versionDirsToProcess);
    await downloadMaterialIcons();
    
    const professionsToProcess = requestedProfession ? [requestedProfession] : PROFESSIONS;
    for (const versionDir of versionDirsToProcess) {
      for (const profession of professionsToProcess) {
        if (versionDir !== 'tbc' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;
        await downloadRecipeIcons(profession, versionDir);
      }
    }
  } else {
    console.log(`Skipping icon download phase`);
  }

  await browser.close();

  // Phase 4: Zip icons (runs after icon download, or standalone via --phase zip)
  if (phases.zip) {
    console.log(`\nZipping icon directories...`);
    await zipIcons();
  } else {
    console.log(`Skipping zip phase`);
  }

  console.log(`\nAll selected phases complete!`);
})().catch(async (err) => {
  if (err instanceof WowheadBlockedError) {
    console.error(`\n${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});