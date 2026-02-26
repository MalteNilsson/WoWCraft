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

const streamPipeline = promisify(pipeline);

const PROFESSIONS = [
  'alchemy',
  'blacksmithing',
  'enchanting',
  'engineering',
  'jewelcrafting',
  'leatherworking',
  'tailoring',
];

// Game versions and their WoWhead URL paths
const GAME_VERSIONS = ['Vanilla', 'The Burning Crusade'];
const VERSION_BASE_URLS = {
  'Vanilla': 'https://www.wowhead.com/classic/spells/professions/',
  'The Burning Crusade': 'https://www.wowhead.com/tbc/spells/professions/',
};
const VERSION_FILTERS = {
  'Vanilla': '?filter=20:21;1:5;0:11400',
  'The Burning Crusade': '?filter=20;1;0',
};

// Jewelcrafting only exists in TBC
const TBC_ONLY_PROFESSIONS = ['jewelcrafting'];

// Directory names for version-specific recipe storage
const VERSION_TO_DIR = { 'Vanilla': 'vanilla', 'The Burning Crusade': 'tbc' };

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
  zip: true
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
      });
      i++; // Skip next arg as it's the phase value
    }
  } else if (arg === '--version' || arg === '-v') {
    const ver = args[i + 1]?.toLowerCase();
    if (ver === 'vanilla') requestedVersion = 'Vanilla';
    else if (ver === 'tbc' || ver === 'the burning crusade') requestedVersion = 'The Burning Crusade';
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
  --version <ver>      Scrape only specified version (vanilla, tbc). Default: both
  --phase <phases>     Run only specified phases (comma-separated)
                       Available phases: scrape, enrich, icons, zip
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
const globalMaterialDataByVersion = { vanilla: {}, tbc: {} };

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



/** Fetch listview data from HTML (avoids Puppeteer, less likely to be blocked) */
const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const fetchListviewData = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': FETCH_UA, 'Accept': 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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

/** Parse limited stock from item HTML - extracts sold-by Listview data (no scripts required) */
function parseLimitedStockFromHtml(html) {
  const soldByIdx = html.search(/id:\s*['"]sold-by['"]/);
  if (soldByIdx === -1) return false;

  const dataIdx = html.indexOf('data:', soldByIdx);
  if (dataIdx === -1) return false;

  const arrayStart = html.indexOf('[', dataIdx);
  if (arrayStart === -1) return false;

  const dataStr = extractBalanced(html, arrayStart - 1, '[', ']');
  if (!dataStr) return false;

  try {
    const data = new Function('return ' + dataStr)();
    return Array.isArray(data) && data.some(v => typeof v?.stock === 'number' && v.stock > 0);
  } catch {
    return false;
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

  const addData6Idx = html.indexOf('WH.Gatherer.addData(6, 5, ');
  const spellIcons = addData6Idx >= 0 ? (() => {
    const obj = extractBalanced(html, addData6Idx + 'WH.Gatherer.addData(6, 5, '.length, '{', '}');
    if (!obj) return {};
    try {
      return new Function('return ' + obj)();
    } catch { return {}; }
  })() : {};

  const addData3Idx = html.indexOf('WH.Gatherer.addData(3, 5, ');
  const itemData = addData3Idx >= 0 ? (() => {
    const obj = extractBalanced(html, addData3Idx + 'WH.Gatherer.addData(3, 5, '.length, '{', '}');
    if (!obj) return {};
    try {
      return new Function('return ' + obj)();
    } catch { return {}; }
  })() : {};

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

    // WoWhead source: [6] = trainer, [1] = item (recipe item ID may follow), missing = free
    let source = { type: 'free' };
    if (s.source && Array.isArray(s.source)) {
      if (s.source[0] === 6 && s.trainingcost != null) {
        source = { type: 'trainer', cost: s.trainingcost };
      } else if (s.source[0] === 1 && s.source[1]) {
        source = { type: 'item', recipeItemId: s.source[1], recipeItemName: '' };
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
  const baseUrl = VERSION_BASE_URLS[version];
  const filterQuery = VERSION_FILTERS[version] || VERSION_FILTERS['Vanilla'];
  const listUrl = `${baseUrl}${profession}${filterQuery}`;
  const spellBaseUrl = baseUrl.replace(/\/spells\/professions\/?$/, '/') || baseUrl.split('/spells/')[0] + '/';

  console.log(`\n🔍 Scraping: ${profession} (${version})`);

  // Try fetch-based extraction first (no Puppeteer, less likely to be blocked)
  try {
    console.log(`  Fetching listview data from ${listUrl}...`);
    const html = await fetchListviewData(listUrl);
    const { recipes } = parseListviewFromHtml(html, spellBaseUrl);
    const allRecipes = recipes.map((r) => ({ ...r, _version: version }));
    console.log(`  ✅ Fetched ${allRecipes.length} recipes from embedded HTML`);

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
    console.log(`  ⚠️ Fetch failed (${fetchErr.message}), falling back to Puppeteer...`);
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
        console.log(`  ⚠️ Load failed (${err.message}), retrying in 5s...`);
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
        console.log(`📄 Scraping page ${pageCount} (${version}) → ${paginatedUrl}`);
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
          }).filter(r => r && r.id && r.name); // 🚫 filter out nulls and incomplete recipes
        }, listviewSelector);


      console.log(`🔎 Found ${recipes.length} recipes on page ${pageCount}`);

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
        console.log(`⚠️ DOM diagnostic (${version}):`, JSON.stringify(diag, null, 2));
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
              console.log('🏁 Starting page evaluation');
              
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
              console.log('📑 Taught by Item Tab Content:', taughtByItemTab ? {
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
                    console.log(`🔍 [${recipeId}] Training cost parsing:`, {
                      divHTML: trainingCostDiv.innerHTML,
                      divText: trainingCostDiv.textContent,
                      moneySpansFound: moneySpans.length,
                      spans: Array.from(moneySpans).map(s => ({ text: s.textContent, class: s.className })),
                      totalCost: trainerCost
                    });
                  }
                  
                  // Debug logging
                  if (moneySpans.length === 0) {
                    console.log(`⚠️ [${recipeId}] Found "Training cost:" div but no money spans. Div HTML: "${trainingCostDiv.innerHTML}"`);
                  }
                } else {
                  console.log(`⚠️ [${recipeId}] Could not find div containing "Training cost:" text`);
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
              console.log(`🔧 [${recipe.id}] Produces item ${produces.id} (${produces.name})`);
            }

            if (source) {
              recipe.source = source;
              console.log(`📚 [${recipe.id}] Source: ${source.type}${source.type === 'trainer' ? ` (${source.cost}c)` : ''}${source.type === 'item' ? ` [Item: ${source.recipeItemId}]` : ''}`);
            }
          } catch (err) {
            console.error(`❌ [${recipe.id}] Error:`, err.message);
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
      console.log(`🧹 Closing ${detailPagePool.length} reusable detail pages...`);
      await Promise.all(detailPagePool.map(p => p.close()));
    }
  } catch (err) {
    console.error(`❌ Error scraping ${profession} (${version}):`, err.message);
    return [];
  } finally {
    await page.close();
  }
};

/** Strip _version and flatten for saving (no versioned structure) */
const toFlatRecipe = (r) => {
  const { _version, ...flat } = r;
  return flat;
};

/** Scrape a profession for applicable versions; save each version to its own directory */
const scrapeProfession = async (browser, profession) => {
  const versionsToScrape = (requestedVersion
    ? [requestedVersion]
    : GAME_VERSIONS
  ).filter(v => {
    if (TBC_ONLY_PROFESSIONS.includes(profession) && v === 'Vanilla') return false;
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

    console.log(`✅ Saved ${flatRecipes.length} recipes (${version}) → ${outputPath}`);
    await processRecipeItems(profession, flatRecipes, browser, versionDir);
  }
};

const WOWHEAD_VERSION_PATH = { vanilla: 'classic', tbc: 'tbc' };
const ENRICH_CONCURRENCY = 20; // Parallel XML fetches per batch

const enrichMaterialData = async (browser) => {
    const materialsBaseDir = path.join(__dirname, '..', 'data', 'materials');
    const recipesDir = path.join(__dirname, '..', 'data', 'recipes');

    const versionDirsToEnrich = requestedVersion
      ? [VERSION_TO_DIR[requestedVersion]]
      : ['vanilla', 'tbc'];
    console.log(`🔄 Enrichment: ${requestedVersion ? requestedVersion : 'both versions'}`);

    for (const versionDir of versionDirsToEnrich) {
      const materialPath = path.join(materialsBaseDir, versionDir, 'materials.json');
      const wowheadPath = WOWHEAD_VERSION_PATH[versionDir];
      let materials = {};

      try {
        const raw = await fs.readFile(materialPath, 'utf-8');
        materials = JSON.parse(raw);
        console.log(`📦 [${versionDir}] Loaded ${Object.keys(materials).length} materials`);
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
          console.log(`📦 [${versionDir}] Rebuilt ${Object.keys(materials).length} materials from recipes`);
        } catch (rebuildErr) {
          console.warn(`⚠️ [${versionDir}] No recipes, skipping enrichment`);
          continue;
        }
      }

      const materialIds = Object.keys(materials).filter(id => {
        const mat = materials[id];
        return !mat.name || mat.name === '' || mat.name.trim() === '';
      });
      console.log(`🔄 [${versionDir}] Enriching ${materialIds.length} materials (${wowheadPath} URL)...`);

      if (materialIds.length === 0) {
        console.log(`✅ [${versionDir}] All enriched.`);
        continue;
      }

    // Create one reusable page for limited stock checks (avoids create/destroy per material)
    let limitedStockPage = null;
    if (browser && materialIds.length > 0) {
      limitedStockPage = await browser.newPage();
      await limitedStockPage.setViewport({ width: 1920, height: 1080 });
    }

    try {
    // Fetch XML in parallel batches
    const fetchOneXml = async (id) => {
      const url = `https://www.wowhead.com/${wowheadPath}/item=${id}&xml`;
      try {
        const response = await fetch(url);
        const xml = await response.text();
        const parsed = await parseStringPromise(xml);
        const item = parsed?.wowhead?.item?.[0];
        const name = item?.name?.[0];
        const quality = parseInt(item?.quality?.[0]?.$?.id || 1);
        const itemClass = item?.class?.[0]?._?.trim() || '';
        const subclass = item?.subclass?.[0]?._?.trim() || '';
        const slot = item?.inventorySlot?.[0]?._?.trim() || '';
        const link = item?.link?.[0]?.trim() || '';
        let vendorPrice = null;
        const jsonEquipStr = item?.jsonEquip?.[0];
        if (typeof jsonEquipStr === 'string') {
          try {
            const json = JSON.parse(`{${jsonEquipStr}}`);
            vendorPrice = json.buyprice ?? null;
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
        return { id, name, quality, itemClass, subclass, icon, slot, link, vendorPrice, createdBy };
      } catch (err) {
        console.warn(`❌ Error fetching item ${id}: ${err.message}`);
        return { id, error: err.message };
      }
    };

    for (let i = 0; i < materialIds.length; i += ENRICH_CONCURRENCY) {
      const batch = materialIds.slice(i, i + ENRICH_CONCURRENCY);
      const batchNum = Math.floor(i / ENRICH_CONCURRENCY) + 1;
      const totalBatches = Math.ceil(materialIds.length / ENRICH_CONCURRENCY);
      console.log(`  [${versionDir}] Batch ${batchNum}/${totalBatches} (${batch.length} items)...`);
      const results = await Promise.all(batch.map(id => fetchOneXml(id)));
      for (const r of results) {
        if (r.error) continue;
        const { id, name, quality, itemClass, subclass, icon, slot, link, vendorPrice, createdBy } = r;
        if (!name || name.trim() === '') {
          console.warn(`    ⚠️ No name found for item ${id}, skipping`);
          continue;
        }
        let limitedStock = false;
        if (vendorPrice !== null && limitedStockPage) {
          try {
            const itemUrl = `https://www.wowhead.com/${wowheadPath}/item=${id}#sold-by`;
            await limitedStockPage.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            try {
              await limitedStockPage.waitForSelector('table.listview-mode-default tbody tr.listview-row', { timeout: 3000 });
            } catch {}
            const vendorInfo = await limitedStockPage.evaluate(() => {
              const vendorTable = document.querySelector('table.listview-mode-default');
              if (!vendorTable) return { limitedStock: false, hasCurrencyPrice: false };
              const rows = vendorTable.querySelectorAll('tbody tr.listview-row');
              if (rows.length === 0) return { limitedStock: false, hasCurrencyPrice: false };
              let hasCurrencyPrice = false, limitedStock = false;
              for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 7) {
                  const costCell = cells[6];
                  if (costCell) {
                    const hasCurrency = costCell.querySelector('.moneygold, .moneysilver, .moneycopper') !== null;
                    const hasItemCurrency = costCell.querySelector('.moneyitem') !== null;
                    if (hasCurrency && !hasItemCurrency) {
                      hasCurrencyPrice = true;
                      const stockCell = cells[4];
                      if (stockCell) {
                        const stockText = stockCell.textContent.trim();
                        if (stockText !== '∞' && stockText !== '' && !isNaN(parseInt(stockText))) limitedStock = true;
                      }
                    }
                  }
                }
              }
              return { limitedStock, hasCurrencyPrice };
            });
            if (!vendorInfo.hasCurrencyPrice) {
              materials[id] = { name, quality, class: itemClass, subclass, icon, slot, link, vendorPrice: null, ...(createdBy ? { createdBy } : {}) };
            } else {
              limitedStock = vendorInfo.limitedStock;
              materials[id] = { name, quality, class: itemClass, subclass, icon, slot, link, vendorPrice, ...(limitedStock ? { limitedStock: true } : {}), ...(createdBy ? { createdBy } : {}) };
            }
          } catch (err) {
            console.warn(`⚠️ Limited stock check failed for ${id}: ${err.message}`);
            materials[id] = { name, quality, class: itemClass, subclass, icon, slot, link, vendorPrice, ...(createdBy ? { createdBy } : {}) };
          }
        } else {
          materials[id] = { name, quality, class: itemClass, subclass, icon, slot, link, vendorPrice, ...(limitedStock ? { limitedStock: true } : {}), ...(createdBy ? { createdBy } : {}) };
        }
        console.log(`    ✅ Enriched item ${id}: ${name}`);
      }
      if (i + ENRICH_CONCURRENCY < materialIds.length) {
        await new Promise(r => setTimeout(r, 300)); // Brief pause between batches
      }
    }
    console.log(`✅ Processed ${materialIds.length} materials`);
  
    await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
    console.log(`✅ [${versionDir}] Enrichment complete → ${materialPath}`);
      } finally {
        if (limitedStockPage) {
          await limitedStockPage.close();
          console.log(`  🧹 [${versionDir}] Closed limited-stock page`);
        }
      }
    }
  };


  const downloadMaterialIcons = async () => {
    const materialsBaseDir = path.join(__dirname, '..', 'data', 'materials');
    const projectRoot = path.join(__dirname, '..', '..');
    const iconDir = path.join(projectRoot, 'public', 'icons', 'materials');
    await fs.mkdir(iconDir, { recursive: true });

    const allMaterials = {};
    for (const versionDir of ['vanilla', 'tbc']) {
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
        const response = await fetch(iconUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await streamPipeline(response.body, createWriteStream(targetPath));
        console.log(`🟢 Saved material icon ${id} → ${material.icon}.jpg`);
      } catch (err) {
        console.warn(`❌ Failed to download icon for material ${id}: ${err.message}`);
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
  
    for (const recipe of recipes) {
      const icon = recipe.icon; // you'd need to extract and save this during scraping
      const id = recipe.id;
      if (!icon) continue;
  
      const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
      const targetPath = path.join(iconDir, `${id}.jpg`);
  
      try {
        const response = await fetch(iconUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await streamPipeline(response.body, createWriteStream(targetPath));
        console.log(`🟢 Saved recipe icon ${id} → ${icon}.jpg`);
      } catch (err) {
        console.warn(`❌ Failed to download icon for recipe ${id}: ${err.message}`);
      }
    }
  };

const processRecipeItems = async (profession, recipes, browser, versionDir) => {
  console.log(`\n📦 Processing recipe items for ${profession} (${versionDir})...`);
  
  const recipeItems = {};
  
  // Use version-specific WoWhead path (TBC items may not exist on classic endpoint)
  const wowheadPath = versionDir === 'tbc' ? 'tbc' : 'classic';
  
  try {
    // Get all unique recipe item IDs (flat format)
    const recipeItemIds = new Set();
    recipes.forEach(recipe => {
      if (recipe.source?.type === 'item') recipeItemIds.add(recipe.source.recipeItemId);
    });
    
    const itemIds = Array.from(recipeItemIds);
    console.log(`Found ${itemIds.length} unique recipe items to process`);

    // Process all items in parallel
    console.log('🔄 Fetching XML data for all items...');
    const results = await Promise.all(itemIds.map(async (itemId) => {
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
              console.warn(`⚠️ Failed to parse jsonEquip for item ${itemId}`);
            }
          }
          return { bop: isRecipeBoP, buyPrice };
        };

        let xmlData;
        try {
          const xmlUrl = `https://www.wowhead.com/${wowheadPath}/item=${itemId}&xml`;
          const xmlText = await fetch(xmlUrl).then(r => r.text());
          xmlData = await parseXml(xmlText);
        } catch (primaryErr) {
          // Fallback: try other endpoint if version-specific parse fails (e.g. TBC item on classic)
          const fallbackPath = wowheadPath === 'tbc' ? 'classic' : 'tbc';
          try {
            const fallbackUrl = `https://www.wowhead.com/${fallbackPath}/item=${itemId}&xml`;
            const xmlText = await fetch(fallbackUrl).then(r => r.text());
            xmlData = await parseXml(xmlText);
          } catch {
            throw primaryErr;
          }
        }

        // Fetch HTML data for limited stock info (parses sold-by Listview, no scripts required)
        const htmlUrl = `https://www.wowhead.com/${wowheadPath}/item=${itemId}`;
        const htmlData = await fetch(htmlUrl)
          .then(response => response.text())
          .then(html => ({
            limitedStock: parseLimitedStockFromHtml(html)
          }))
          .catch(err => {
            console.error(`❌ HTML fetch error for item ${itemId}:`, err.message);
            return { limitedStock: false };
          });

        return {
          itemId,
          data: {
            bop: xmlData.bop,
            limitedStock: htmlData.limitedStock,
            buyPrice: xmlData.buyPrice,
            auctionhouse: !xmlData.bop && !htmlData.limitedStock && !xmlData.buyPrice
          }
        };

      } catch (err) {
        console.error(`❌ Error processing item ${itemId}:`, err.message);
        return { itemId, data: null };
      }
    }));

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
    
    console.log(`\n✅ Saved ${Object.keys(recipeItems).length} recipe items → ${outputPath}`);
    
  } catch (err) {
    console.error('❌ Error processing recipe items:', err.message);
  }
  
  return recipeItems;
};

(async () => {
  // When only zip phase is requested, run it standalone (no browser or materials needed)
  const onlyZip = phases.zip && !phases.scrape && !phases.enrich && !phases.downloadIcons;
  if (onlyZip) {
    console.log('Running zip phase only...\n');
    await zipIcons();
    console.log('\n✅ Zip phase complete!');
    process.exit(0);
  }

    const outputDirMaterials = path.join(__dirname, '..', 'data', 'materials');
    const materialPath = path.join(outputDirMaterials, 'materials.json');

    // Load existing materials (version-specific or legacy single file)
    const versionDirsToProcess = requestedVersion
      ? [VERSION_TO_DIR[requestedVersion]]
      : ['vanilla', 'tbc'];
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
        console.log(`📦 Loaded ${Object.keys(parsed).length} materials from ${versionDir}/materials.json`);
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
            console.log(`📦 Loaded ${Object.keys(parsed).length} materials from legacy materials.json`);
            loadedFromLegacy = true;
          } catch {
            console.log(`📁 No existing materials found, starting fresh.`);
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
        console.error(`❌ Invalid profession: ${requestedProfession}`);
        console.log(`➡️ Valid options: ${PROFESSIONS.join(', ')}`);
        await browser.close();
        process.exit(1);
      }
      await scrapeProfession(browser, requestedProfession);
    } else {
      for (const profession of PROFESSIONS) {
        await scrapeProfession(browser, profession);
      }
      console.log(`\n🎉 All professions scraped successfully.`);
    }
    
    // ✅ Write materials.json per version (vanilla/tbc)
    await fs.mkdir(outputDirMaterials, { recursive: true });
    for (const versionDir of versionDirsToProcess) {
      const data = globalMaterialDataByVersion[versionDir] || {};
      const versionPath = path.join(outputDirMaterials, versionDir, 'materials.json');
      await fs.mkdir(path.dirname(versionPath), { recursive: true });
      await fs.writeFile(versionPath, JSON.stringify(data, null, 2));
      console.log(`✅ Saved ${Object.keys(data).length} materials (${versionDir}) → ${versionPath}`);
    }
  } else {
    console.log(`⏭️  Skipping scrape phase`);
  }

  // Phase 2: Enrich material data
  if (phases.enrich) {
    console.log(`\n🔄 Starting material enrichment phase...`);
    await enrichMaterialData(browser);
  } else {
    console.log(`⏭️  Skipping enrichment phase`);
  }

  // Phase 3: Download icons
  if (phases.downloadIcons) {
    await downloadMaterialIcons();
    
    const professionsToProcess = requestedProfession ? [requestedProfession] : PROFESSIONS;
    for (const versionDir of versionDirsToProcess) {
      for (const profession of professionsToProcess) {
        if (versionDir === 'vanilla' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;
        await downloadRecipeIcons(profession, versionDir);
      }
    }
  } else {
    console.log(`⏭️  Skipping icon download phase`);
  }

  await browser.close();

  // Phase 4: Zip icons (runs after icon download, or standalone via --phase zip)
  if (phases.zip) {
    console.log(`\nZipping icon directories...`);
    await zipIcons();
  } else {
    console.log(`⏭️  Skipping zip phase`);
  }

  console.log(`\n✅ All selected phases complete!`);
})();