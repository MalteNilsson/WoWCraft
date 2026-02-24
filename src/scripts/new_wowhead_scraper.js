// src/scripts/new_wowhead_scraper.js
// WoWhead scraper - fetch HTML only, no JavaScript execution, no Puppeteer

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFESSIONS = [
  'alchemy',
  'blacksmithing',
  'enchanting',
  'engineering',
  'jewelcrafting',
  'leatherworking',
  'tailoring',
];

const GAME_VERSIONS = ['Vanilla', 'The Burning Crusade'];
const VERSION_TO_DIR = { 'Vanilla': 'vanilla', 'The Burning Crusade': 'tbc' };
const VERSION_BASE_URLS = {
  'Vanilla': 'https://www.wowhead.com/classic/spells/professions/',
  'The Burning Crusade': 'https://www.wowhead.com/tbc/spells/professions/',
};
const VERSION_FILTERS = {
  'Vanilla': '?filter=20:21;1:5;0:11400',
  'The Burning Crusade': '?filter=20;1;0',
};

const TBC_ONLY_PROFESSIONS = ['jewelcrafting'];

const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Parse CLI args
let requestedProfession = null;
let requestedVersion = null;
let requestedSkipMaterials = false;
let requestedMaterialsOnly = false;
let requestedIconsOnly = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version' || args[i] === '-v') {
    const v = args[++i]?.toLowerCase();
    if (v === 'vanilla') requestedVersion = 'Vanilla';
    else if (v === 'tbc' || v === 'the burning crusade') requestedVersion = 'The Burning Crusade';
  } else if (args[i] === '--profession' || args[i] === '-p') {
    requestedProfession = args[++i];
  } else if (args[i] === '--skip-materials') {
    requestedSkipMaterials = true;
  } else if (args[i] === '--materials-only') {
    requestedMaterialsOnly = true;
  } else if (args[i] === '--icons-only') {
    requestedIconsOnly = true;
  } else if (args[i] === 'help' || args[i] === '-h' || args[i] === '--help') {
    console.log('Usage: node new_wowhead_scraper.js [--version vanilla|tbc] [--profession <name>] [--skip-materials] [--materials-only] [--icons-only]');
    console.log('  --version, -v   Scrape only specified version');
    console.log('  --profession, -p  Scrape only specified profession');
    console.log('  --skip-materials  Skip fetching material item pages and building materials.json');
    console.log('  --materials-only  Only build materials.json from existing recipes (requires --version)');
    console.log('  --icons-only     Only download missing material icons from existing materials.json');
    process.exit(0);
  }
}

/** Extract balanced bracket/brace content (handles nested structures) */
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
}

/** Parse listviewspells from WoWhead profession page HTML - no scripts, pure string parsing */
function parseListviewSpellsFromHtml(html, spellBaseUrl) {
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
    } catch {
      return {};
    }
  })() : {};

  const addData3Idx = html.indexOf('WH.Gatherer.addData(3, 5, ');
  const itemNames = addData3Idx >= 0 ? (() => {
    const obj = extractBalanced(html, addData3Idx + 'WH.Gatherer.addData(3, 5, '.length, '{', '}');
    if (!obj) return {};
    try {
      const items = new Function('return ' + obj)();
      const names = {};
      for (const [id, data] of Object.entries(items || {})) {
        if (data && typeof data === 'object' && data.name_enus) names[String(id)] = data.name_enus;
      }
      return names;
    } catch {
      return {};
    }
  })() : {};

  const recipes = spells.map((s) => {
    const materials = {};
    const inputItems = [];
    (s.reagents || []).forEach(([id, qty]) => {
      if (id && qty > 0) {
        materials[String(id)] = qty;
        inputItems.push({
          id: Number(id),
          name: itemNames[String(id)] || '',
          quantity: qty,
        });
      }
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
      produces = {
        id: s.creates[0],
        name: itemNames[String(s.creates[0])] || '',
        quantity: s.creates[1] ?? 1,
      };
    }

    // WoWhead source: [6] = trainer, [1] or [5] = item (recipe item ID may follow), missing = free
    // [1] = dropped, [5] = item-bound; world-drop recipes may have [1] or [5] without ID in listview
    let source = { type: 'free' };
    if (s.source && Array.isArray(s.source)) {
      if (s.source[0] === 6 && s.trainingcost != null) {
        source = { type: 'trainer', cost: s.trainingcost };
      } else if ((s.source[0] === 1 || s.source[0] === 5) && s.source[1]) {
        source = { type: 'item', recipeItemId: s.source[1], recipeItemName: '' };
      } else if (s.source[0] === 1 || s.source[0] === 5) {
        // source [1] or [5] without recipe item ID; need to visit spell page (e.g. world-drop Mithril Spurs)
        source = { type: 'item', recipeItemId: null, recipeItemName: '', _needSpellVisit: true };
      }
    }

    const spellLink = `${spellBaseUrl}spell=${s.id}`;
    return {
      id: s.id,
      name: s.name || '',
      quality: s.quality ?? 1,
      difficulty,
      materials,
      inputItems,
      minSkill: difficulty.orange ?? null,
      icon,
      url: spellLink,
      spellLink,
      produces,
      source,
    };
  }).filter((r) => r && r.id && r.name);

  return recipes;
}

/** Fetch HTML for a profession page (single request, no JS) */
async function fetchProfessionHtml(profession, version) {
  const baseUrl = VERSION_BASE_URLS[version];
  const filter = VERSION_FILTERS[version] || VERSION_FILTERS['Vanilla'];
  const url = `${baseUrl}${profession}${filter}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': FETCH_UA, 'Accept': 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch HTML for a recipe spell page or item page */
async function fetchPageHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': FETCH_UA, 'Accept': 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fetch XML tooltip for an item from Wowhead (e.g. https://www.wowhead.com/tbc/item=2578&xml) */
async function fetchItemXml(itemId, wowheadPath) {
  const url = `https://www.wowhead.com/${wowheadPath}/item=${itemId}&xml`;
  const res = await fetch(url, {
    headers: { 'User-Agent': FETCH_UA, 'Accept': 'application/xml,text/xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Parse Wowhead item XML tooltip. Extracts class, subclass, slot, itemLevel.
 * Returns { class, subclass, slot, itemLevel } with empty strings for missing fields.
 */
function parseItemXml(xml) {
  const result = { class: '', subclass: '', slot: '', itemLevel: null };
  const classMatch = xml.match(/<class\s+id="(\d+)"[^>]*>/);
  if (classMatch) result.class = classMatch[1];
  const subclassMatch = xml.match(/<subclass\s+id="(\d+)"[^>]*>/);
  if (subclassMatch) result.subclass = subclassMatch[1];
  const slotMatch = xml.match(/<inventorySlot\s+id="(\d+)"[^>]*>/);
  if (slotMatch) result.slot = slotMatch[1];
  const levelMatch = xml.match(/<level>(\d+)<\/level>/);
  if (levelMatch) result.itemLevel = parseInt(levelMatch[1], 10);
  return result;
}

/**
 * Parse recipe detail page to determine source type.
 * Trainer-bound (takes precedence): has gold/silver/copper cost, no associated recipe items.
 * Item-bound: taught by recipe item (e.g. Plans: Adamantite Dagger).
 */
function parseRecipePageSource(html) {
  const result = { type: 'unknown' };

  // Trainer-bound: Training cost in markup or trainingcost in g_spells (takes precedence)
  const trainingCostMatch = html.match(/Training cost:\s*\[money=(\d+)\]/);
  const trainingCostExtend = html.match(/"trainingcost":(\d+)/) || html.match(/trainingcost:\s*(\d+)/);
  const cost = trainingCostMatch?.[1] ?? trainingCostExtend?.[1];
  if (cost != null) {
    result.type = 'trainer';
    result.cost = parseInt(cost, 10); // in copper
    return result;
  }

  // Item-bound: taught-by-item listview with recipe item
  const taughtByItemMatch = html.match(/taught-by-item.*?data:\s*\[\s*\{.*?"id":(\d+).*?"name":"([^"]+)"/s);
  if (taughtByItemMatch) {
    result.type = 'item';
    result.recipeItemId = parseInt(taughtByItemMatch[1], 10);
    result.recipeItemName = taughtByItemMatch[2];
    return result;
  }

  // Free: no cost, no recipe item — learned automatically at level 1
  result.type = 'free';
  return result;
}

const CONCURRENCY = 3000;

/** Run async tasks with a concurrency limit */
async function runWithConcurrency(tasks, concurrency = CONCURRENCY) {
  const all = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().finally(() => executing.delete(p));
    all.push(p);
    executing.add(p);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(all);
}

/**
 * Parse recipe item page (e.g. Plans: Adamantite Maul) for full info.
 * Returns { buyPrice, limitedStock, vendorStack, bop, auctionhouse } for profession_items.json.
 */
function parseRecipeItemFullInfo(html) {
  const result = {
    buyPrice: null,
    limitedStock: false,
    vendorStack: null,
    bop: false,
    auctionhouse: false,
  };

  // buyPrice: from jsonequip (WH.Gatherer.addData or $.extend g_items)
  const buyPriceMatch = html.match(/"buyprice":(\d+)/) || html.match(/buyprice:\s*(\d+)/);
  if (buyPriceMatch) result.buyPrice = parseInt(buyPriceMatch[1], 10);

  // BOP: "Binds when picked up" in tooltip (recipe item itself, not crafted item)
  result.bop = /Binds when picked up/i.test(html);

  // Vendor info: sold-by listview
  const soldByIdx = html.includes("id: 'sold-by'") ? html.indexOf("id: 'sold-by'") : html.indexOf('id: "sold-by"');
  if (soldByIdx !== -1) {
    const dataIdx = html.indexOf('data:', soldByIdx);
    if (dataIdx !== -1) {
      const arrayStart = dataIdx + 'data:'.length;
      const dataRaw = extractBalanced(html, arrayStart - 1, '[', ']');
      if (dataRaw) {
        const vendors = (() => {
          try {
            return new Function('return ' + dataRaw)();
          } catch {
            return [];
          }
        })();
        if (Array.isArray(vendors) && vendors.length > 0) {
          // buyPrice fallback: use min vendor cost if not in jsonequip
          if (result.buyPrice == null) {
            let minCost = null;
            for (const v of vendors) {
              const c = v.cost?.[0]?.[0];
              if (c != null && (minCost == null || c < minCost)) minCost = c;
            }
            if (minCost != null) result.buyPrice = minCost;
          }
          // limitedStock: vendor stock is a number >= 0
          const stock = vendors[0]?.stock;
          if (stock != null && stock >= 0) result.limitedStock = true;
          // vendorStack: column to the right of stock (items sold in stacks > 1, e.g. Water, Vials)
          const v0 = vendors[0];
          const stack = v0?.stack ?? v0?.stacksize ?? v0?.stockstack;
          if (stack != null && stack > 1) result.vendorStack = stack;
        }
      }
    }
  }

  // auctionhouse: can be sold on AH when !bop && !limitedStock && !buyPrice
  result.auctionhouse = !result.bop && !result.limitedStock && result.buyPrice == null;

  return result;
}

/**
 * Parse material item page for materials.json format.
 * Returns { name, quality, class, subclass, icon, slot, link, vendorPrice, sellPrice, limitedStock, vendorStack, itemLevel }.
 */
function parseMaterialItemInfo(html, itemId, wowheadPath) {
  const idStr = String(itemId);
  const result = {
    name: `Item #${itemId}`,
    quality: 1,
    class: '',
    subclass: '',
    icon: '',
    slot: '',
    link: `https://www.wowhead.com/${wowheadPath}/item=${itemId}`,
    vendorPrice: null,
    sellPrice: null,
    limitedStock: false,
    vendorStack: null,
    itemLevel: null,
  };

  // g_pageInfo for name
  const pageInfoMatch = html.match(/g_pageInfo\s*=\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (pageInfoMatch) result.name = pageInfoMatch[1];

  // WH.Gatherer.addData(3, 5, {...}) - item data by id
  const addDataIdx = html.indexOf('WH.Gatherer.addData(3, 5, ');
  if (addDataIdx >= 0) {
    const objStart = addDataIdx + 'WH.Gatherer.addData(3, 5, '.length;
    const obj = extractBalanced(html, objStart - 1, '{', '}');
    if (obj) {
      try {
        const data = new Function('return ' + obj)();
        const item = data?.[idStr];
        if (item) {
          if (item.name_enus) result.name = item.name_enus;
          if (item.quality != null) result.quality = item.quality;
          if (item.icon) result.icon = item.icon;
          const je = item.jsonequip;
          if (je?.buyprice != null) result.vendorPrice = parseInt(je.buyprice, 10);
          if (je?.sellprice != null) result.sellPrice = parseInt(je.sellprice, 10);
          if (je?.classs != null) result.class = String(je.classs);
          else if (item.classs != null) result.class = String(item.classs);
          if (je?.subclass != null) result.subclass = String(je.subclass);
          else if (item.subclass != null) result.subclass = String(item.subclass);
          if (je?.slot != null) result.slot = String(je.slot);
          else if (item.slot != null) result.slot = String(item.slot);
          if (je?.itemlevel != null) result.itemLevel = parseInt(je.itemlevel, 10);
        }
      } catch {}
    }
  }

  // Fallback: item level is in tooltip HTML as <!--ilvl-->N (jsonequip lacks it for TBC/Classic)
  if (result.itemLevel == null) {
    const ilvlMatch = html.match(/<!--ilvl-->(\d+)/);
    if (ilvlMatch) result.itemLevel = parseInt(ilvlMatch[1], 10);
  }

  // Fallback: infer class from tooltip slot (jsonequip often lacks classs for TBC/Classic equip items)
  if (!result.class || result.class === '') {
    // Match slot in tooltip: <tr><td>One-Hand</td> or <tr><td>Main Hand<\/td> (escaped in JS string)
    const slotMatch = html.match(/<tr><td>([^<]+)<\\?\/td><th><!--scstart2/);
    if (slotMatch) {
      const slot = slotMatch[1].trim();
      const weaponSlots = ['One-Hand', 'Two-Hand', 'Main Hand', 'Off Hand', 'Ranged', 'Held In Off-hand', 'Thrown'];
      const armorSlots = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Finger', 'Trinket', 'Shield'];
      if (weaponSlots.includes(slot)) result.class = '2';
      else if (armorSlots.includes(slot)) result.class = '4';
      else if (slot === 'Projectile' || slot === 'Ammo') result.class = '6';
    }
  }

  // limitedStock: from sold-by listview (same logic as parseRecipeItemFullInfo)
  const soldByIdx = html.includes("id: 'sold-by'") ? html.indexOf("id: 'sold-by'") : html.indexOf('id: "sold-by"');
  if (soldByIdx !== -1) {
    const dataIdx = html.indexOf('data:', soldByIdx);
    if (dataIdx !== -1) {
      const arrayStart = dataIdx + 'data:'.length;
      const dataRaw = extractBalanced(html, arrayStart - 1, '[', ']');
      if (dataRaw) {
        const vendors = (() => {
          try {
            return new Function('return ' + dataRaw)();
          } catch {
            return [];
          }
        })();
        if (Array.isArray(vendors) && vendors.length > 0) {
          const stock = vendors[0]?.stock;
          if (stock != null && stock >= 0) result.limitedStock = true;
          // vendorStack: column to the right of stock (items sold in stacks > 1, e.g. Water, Vials)
          const v0 = vendors[0];
          const stack = v0?.stack ?? v0?.stacksize ?? v0?.stockstack;
          if (stack != null && stack > 1) result.vendorStack = stack;
        }
      }
    }
  }

  return result;
}

async function downloadMissingMaterialIcons(versionDirs) {
  const materialsDir = path.join(__dirname, '..', 'data', 'materials');
  const projectRoot = path.join(__dirname, '..', '..');
  const iconDir = path.join(projectRoot, 'public', 'icons', 'materials');
  await fs.mkdir(iconDir, { recursive: true });

  const materials = {};
  for (const versionDir of versionDirs) {
    try {
      const raw = await fs.readFile(path.join(materialsDir, versionDir, 'materials.json'), 'utf-8');
      Object.assign(materials, JSON.parse(raw));
    } catch {
      // skip if no materials for this version
    }
  }

  const toDownload = [];
  for (const [id, mat] of Object.entries(materials)) {
    if (!mat.icon) continue;
    const targetPath = path.join(iconDir, `${id}.jpg`);
    try {
      await fs.access(targetPath);
    } catch {
      toDownload.push({ id, icon: mat.icon, targetPath });
    }
  }

  if (toDownload.length === 0) {
    console.log('All material icons already exist.');
    return;
  }

  console.log(`Downloading ${toDownload.length} missing material icons (${toDownload.length} of ${Object.values(materials).filter(m => m.icon).length} with icons)...`);
  let iconCount = 0;
  const iconTasks = toDownload.map(({ id, icon, targetPath }) => async () => {
    const iconUrl = `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
    try {
      const res = await fetch(iconUrl, {
        headers: { 'User-Agent': FETCH_UA },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(targetPath, buf);
      iconCount++;
      if (iconCount % 50 === 0 || iconCount === toDownload.length) {
        console.log(`  Downloaded ${iconCount}/${toDownload.length} icons`);
      }
    } catch (err) {
      console.error(`  Error downloading icon ${id} (${icon}): ${err.message}`);
    }
  });
  await runWithConcurrency(iconTasks);
}

async function main() {
  if (requestedMaterialsOnly) {
    if (!requestedVersion) {
      console.error('--materials-only requires --version (vanilla or tbc)');
      process.exit(1);
    }
  }

  if (requestedIconsOnly) {
    const versionDirs = requestedVersion
      ? [VERSION_TO_DIR[requestedVersion]]
      : Object.values(VERSION_TO_DIR);
    console.log('Icons-only mode: downloading missing material icons');
    console.log('Versions:', versionDirs.join(', '));
    await downloadMissingMaterialIcons(versionDirs);
    return;
  }

  const versionsToScrape = requestedVersion ? [requestedVersion] : GAME_VERSIONS;
  const professionsToScrape = requestedProfession
    ? [requestedProfession.toLowerCase()]
    : PROFESSIONS;

  console.log('New WoWhead Scraper (HTML fetch only, no JavaScript)');
  if (requestedMaterialsOnly) {
    console.log('Mode: materials-only (building materials.json from existing recipes)');
  }
  console.log('Versions:', versionsToScrape.join(', '));
  console.log('Professions:', professionsToScrape.join(', '));
  console.log('');

  const results = [];

  if (!requestedMaterialsOnly) {
  for (const version of versionsToScrape) {
    const versionDir = VERSION_TO_DIR[version];
    const spellBaseUrl = VERSION_BASE_URLS[version].replace(/\/spells\/professions\/?$/, '/') || VERSION_BASE_URLS[version].split('/spells/')[0] + '/';

    for (const profession of professionsToScrape) {
      if (version === 'Vanilla' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;

      try {
        console.log(`Fetching ${profession} (${version})...`);
        const html = await fetchProfessionHtml(profession, version);
        const recipes = parseListviewSpellsFromHtml(html, spellBaseUrl);
        console.log(`  Found ${recipes.length} recipes`);
        recipes.forEach((r) => console.log(`  ${r.spellLink}`));

        // Step 2a: For item-bound recipes with missing recipeItemId (source [5]/[1]), or source-free
        // (e.g. world-drop Mithril Spurs), visit spell page to resolve taught-by-item
        const needSpellVisit = recipes.filter(
          (r) => r.source?._needSpellVisit || r.source?.type === 'free'
        );
        if (needSpellVisit.length > 0) {
          console.log(`  Resolving ${needSpellVisit.length} item-bound recipes (${CONCURRENCY} concurrent)...`);
          let resolvedCount = 0;
          const spellTasks = needSpellVisit.map((r, i) => async () => {
            try {
              const spellHtml = await fetchPageHtml(r.spellLink);
              const srcInfo = parseRecipePageSource(spellHtml);
              if (srcInfo.type === 'item' && srcInfo.recipeItemId) {
                r.source = {
                  type: 'item',
                  recipeItemId: srcInfo.recipeItemId,
                  recipeItemName: srcInfo.recipeItemName || '',
                };
              } else if (srcInfo.type === 'trainer' && srcInfo.cost != null) {
                r.source = { type: 'trainer', cost: srcInfo.cost };
              } else if (r.source?._needSpellVisit) {
                // Was item-bound but didn't find taught-by-item; treat as free
                r.source = { type: 'free' };
              }
            } catch (err) {
              console.error(`  Error resolving ${r.name}: ${err.message}`);
            }
            resolvedCount++;
            console.log(`  Resolved ${resolvedCount}/${needSpellVisit.length}: ${r.name}`);
          });
          await runWithConcurrency(spellTasks);
        }

        // Step 2b: Visit every item-bound recipe item page and build recipeItems
        const recipeItemIds = [...new Set(
          recipes
            .filter((r) => r.source?.type === 'item' && r.source.recipeItemId)
            .map((r) => r.source.recipeItemId)
        )];
        const recipeItems = {};
        const itemBase = spellBaseUrl;

        if (recipeItemIds.length > 0) {
          console.log(`  Visiting ${recipeItemIds.length} unique recipe item pages (${CONCURRENCY} concurrent)...`);
          let processedCount = 0;
          const itemTasks = recipeItemIds.map((itemId) => async () => {
            const itemUrl = `${itemBase}item=${itemId}`;
            try {
              const itemHtml = await fetchPageHtml(itemUrl);
              const info = parseRecipeItemFullInfo(itemHtml);
              recipeItems[String(itemId)] = {
                buyPrice: info.buyPrice,
                limitedStock: info.limitedStock,
                vendorStack: info.vendorStack,
                bop: info.bop,
                auctionhouse: info.auctionhouse,
              };
              // Update recipeItemName from g_pageInfo
              const nameMatch = itemHtml.match(/g_pageInfo\s*=\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
              if (nameMatch) {
                recipes.forEach((r) => {
                  if (r.source?.type === 'item' && r.source.recipeItemId === itemId) {
                    r.source.recipeItemName = nameMatch[1];
                  }
                });
              }
            } catch (err) {
              console.error(`  Error fetching item ${itemId}: ${err.message}`);
            }
            processedCount++;
            console.log(`  Processed ${processedCount}/${recipeItemIds.length} recipe items`);
          });
          await runWithConcurrency(itemTasks);
        }

        // Build lastRecipeInfo for summary (from last recipe + recipeItems)
        let lastRecipeInfo = null;
        if (recipes.length > 0) {
          const lastRecipe = recipes[recipes.length - 1];
          lastRecipeInfo = {
            recipeName: lastRecipe.name,
            spellLink: lastRecipe.spellLink,
            type: lastRecipe.source?.type || 'free',
            cost: lastRecipe.source?.cost,
            recipeItemId: lastRecipe.source?.recipeItemId,
            recipeItemName: lastRecipe.source?.recipeItemName,
          };
          if (lastRecipe.source?.type === 'item' && lastRecipe.source.recipeItemId) {
            const itemData = recipeItems[String(lastRecipe.source.recipeItemId)];
            if (itemData) {
              lastRecipeInfo.vendorCost = itemData.buyPrice;
              lastRecipeInfo.vendorStock = itemData.limitedStock ? 1 : null;
            }
          }
        }

        results.push({ profession, version, versionDir, recipes, recipeItems, lastRecipeInfo });
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      }
    }
  }

  const allRecipes = results.flatMap((r) => r.recipes);
  console.log(`\nTotal: ${allRecipes.length} recipes`);

  // Summary: last recipe info per profession
  console.log('\n--- Last recipe info per profession ---');
  for (const { profession, version, lastRecipeInfo, recipes } of results) {
    if (lastRecipeInfo) {
      const lastRecipe = recipes?.[recipes.length - 1];
      console.log(`${profession} (${version}): ${lastRecipeInfo.recipeName}`);
      console.log(`  Spell: ${lastRecipeInfo.spellLink}`);
      let src = lastRecipeInfo.type;
      if (lastRecipeInfo.cost != null) src += ` (cost: ${lastRecipeInfo.cost} copper)`;
      if (lastRecipeInfo.recipeItemName) src += ` (${lastRecipeInfo.recipeItemName}, id: ${lastRecipeInfo.recipeItemId})`;
      if (lastRecipeInfo.vendorCost != null) src += ` | Vendor: ${lastRecipeInfo.vendorCost} copper`;
      if (lastRecipeInfo.vendorStock != null) src += `, stock: ${lastRecipeInfo.vendorStock}`;
      else if (lastRecipeInfo.vendorCost != null) src += `, stock: ∞`;
      console.log(`  Source: ${src}`);
      if (lastRecipe?.inputItems?.length) {
        const itemsStr = lastRecipe.inputItems.map((i) => `${i.name || i.id} (${i.quantity})`).join(', ');
        console.log(`  Input items: ${itemsStr}`);
      }
    }
  }

  // Save each profession to its own file
  const outputDir = path.join(__dirname, '..', 'data', 'recipes');
  for (const { profession, versionDir, recipes, recipeItems } of results) {
    // Clean up internal flags before saving
    recipes.forEach((r) => {
      if (r.source && r.source._needSpellVisit) delete r.source._needSpellVisit;
    });
    const dir = path.join(outputDir, versionDir);
    await fs.mkdir(dir, { recursive: true });
    const outputPath = path.join(dir, `${profession}.json`);
    await fs.writeFile(outputPath, JSON.stringify(recipes, null, 2));
    console.log(`Saved ${recipes.length} recipes → ${outputPath}`);

    const itemsPath = path.join(dir, `${profession}_items.json`);
    const itemsOutput = {};
    for (const [id, data] of Object.entries(recipeItems || {})) {
      const entry = {
        bop: data.bop === true,
        limitedStock: data.limitedStock === true,
        buyPrice: data.buyPrice ?? null,
      };
      if (data.auctionhouse) entry.auctionhouse = true;
      if (data.vendorStack != null && data.vendorStack > 1) entry.vendorStack = data.vendorStack;
      itemsOutput[id] = entry;
    }
    await fs.writeFile(itemsPath, JSON.stringify(itemsOutput, null, 2));
    console.log(`Saved ${Object.keys(itemsOutput).length} recipe items → ${itemsPath}`);
  }
  }

  // Build materials.json from all recipes (load from disk to get full picture)
  if (!requestedMaterialsOnly && requestedSkipMaterials) {
    console.log('\nSkipping materials fetch (--skip-materials)');
    return;
  }

  const recipesDir = path.join(__dirname, '..', 'data', 'recipes');
  const materialsDir = path.join(__dirname, '..', 'data', 'materials');
  const wowheadPathByDir = { vanilla: 'classic', tbc: 'tbc' };
  const versionDirsToBuild = versionsToScrape.map((v) => VERSION_TO_DIR[v]);

  for (const versionDir of versionDirsToBuild) {
    const uniqueMaterialIds = new Set();
    const producedByRecipe = new Map(); // itemId -> recipe (for createdBy)
    const itemNamesFromRecipes = new Map(); // itemId -> name (fallback when WoWhead parse fails)
    const itemBase = versionDir === 'vanilla'
      ? 'https://www.wowhead.com/classic/'
      : 'https://www.wowhead.com/tbc/';

    for (const profession of PROFESSIONS) {
      if (versionDir === 'vanilla' && TBC_ONLY_PROFESSIONS.includes(profession)) continue;
      let recipes;
      try {
        const raw = fsSync.readFileSync(path.join(recipesDir, versionDir, `${profession}.json`), 'utf-8');
        recipes = JSON.parse(raw);
      } catch {
        continue;
      }

      for (const r of recipes) {
        for (const input of r.inputItems || []) {
          if (input?.id) {
            uniqueMaterialIds.add(input.id);
            if (input.name) itemNamesFromRecipes.set(input.id, input.name);
          }
        }
        const produces = r.produces;
        if (produces?.id) {
          uniqueMaterialIds.add(produces.id);
          producedByRecipe.set(produces.id, r);
          if (produces.name) itemNamesFromRecipes.set(produces.id, produces.name);
        }
      }
    }

    const materialIds = [...uniqueMaterialIds];
    if (materialIds.length === 0) continue;

    console.log(`\nFetching ${materialIds.length} material item pages for ${versionDir} (${CONCURRENCY} concurrent)...`);
    const materials = {};
    const wowheadPath = wowheadPathByDir[versionDir];
    let materialCount = 0;

    const materialTasks = materialIds.map((itemId) => async () => {
      const itemUrl = `${itemBase}item=${itemId}`;
      try {
        const itemHtml = await fetchPageHtml(itemUrl);
        let info = parseMaterialItemInfo(itemHtml, itemId, wowheadPath);
        // Fallback: fetch XML tooltip for class/subclass/slot when HTML parse misses them
        if (!info.class || !info.subclass || !info.slot || info.itemLevel == null) {
          try {
            const xml = await fetchItemXml(itemId, wowheadPath);
            const xmlInfo = parseItemXml(xml);
            if (!info.class && xmlInfo.class) info = { ...info, class: xmlInfo.class };
            if (!info.subclass && xmlInfo.subclass) info = { ...info, subclass: xmlInfo.subclass };
            if (!info.slot && xmlInfo.slot) info = { ...info, slot: xmlInfo.slot };
            if (info.itemLevel == null && xmlInfo.itemLevel != null) info = { ...info, itemLevel: xmlInfo.itemLevel };
          } catch (xmlErr) {
            // Ignore XML fetch failures; keep HTML parse result
          }
        }
        const recipe = producedByRecipe.get(itemId);
        const fallbackName = itemNamesFromRecipes.get(itemId);
        const name = (info.name && info.name !== `Item #${itemId}`) ? info.name : (fallbackName || info.name);
        const entry = {
          name,
          quality: info.quality,
          class: info.class || '',
          subclass: info.subclass || '',
          icon: info.icon,
          slot: info.slot || '',
          link: info.link,
          vendorPrice: info.vendorPrice ?? null,
          ...(info.sellPrice != null && info.sellPrice > 0 && { sellPrice: info.sellPrice }),
          ...(info.limitedStock && { limitedStock: true }),
          ...(info.vendorStack != null && info.vendorStack > 1 && { vendorStack: info.vendorStack }),
          ...(info.itemLevel != null && info.itemLevel > 0 && { itemLevel: info.itemLevel }),
        };
        if (recipe) {
          const qty = recipe.produces?.quantity ?? 1;
          entry.createdBy = {
            spellId: recipe.id,
            spellName: recipe.name || recipe.produces?.name || '',
            reagents: { ...(recipe.materials || {}) },
            minCount: qty,
            maxCount: qty,
          };
        }
        materials[String(itemId)] = entry;
      } catch (err) {
        console.error(`  Error fetching material ${itemId}: ${err.message}`);
        const recipe = producedByRecipe.get(itemId);
        const fallbackName = itemNamesFromRecipes.get(itemId);
        const entry = {
          name: fallbackName || `Item #${itemId}`,
          quality: 1,
          class: '',
          subclass: '',
          icon: '',
          slot: '',
          link: `${itemBase}item=${itemId}`,
          vendorPrice: null,
        };
        if (recipe) {
          const qty = recipe.produces?.quantity ?? 1;
          entry.createdBy = {
            spellId: recipe.id,
            spellName: recipe.name || recipe.produces?.name || '',
            reagents: { ...(recipe.materials || {}) },
            minCount: qty,
            maxCount: qty,
          };
        }
        materials[String(itemId)] = entry;
      }
      materialCount++;
      if (materialCount % 50 === 0 || materialCount === materialIds.length) {
        console.log(`  Fetched ${materialCount}/${materialIds.length} materials`);
      }
    });

    await runWithConcurrency(materialTasks);

    const materialsPath = path.join(materialsDir, versionDir, 'materials.json');
    await fs.mkdir(path.dirname(materialsPath), { recursive: true });
    await fs.writeFile(materialsPath, JSON.stringify(materials, null, 2));
    console.log(`Saved ${Object.keys(materials).length} materials → ${materialsPath}`);

    await downloadMissingMaterialIcons([versionDir]);
  }

  return requestedMaterialsOnly ? [] : results.flatMap((r) => r.recipes);
}

main().catch(console.error);
