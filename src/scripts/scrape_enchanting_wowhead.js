/* eslint-disable no-console */
// To run under ESM, ensure your package.json has `"type": "module"`

import fs from "fs/promises";
import path from "path";
import vm from "vm";
import { fetch } from "undici";             // undici is faster & has keep-alive by default
import pLimit from "p-limit";

const CONCURRENCY = 10;                       // play nice with Wowhead
const limit       = pLimit(CONCURRENCY);



/*──────── URLs ────────*/
const PROF_URL  = "https://www.wowhead.com/classic/skill=333/enchanting";
const SPELL_URL = id => `https://www.wowhead.com/classic/spell=${id}`;
const SPELL_XML = id => `${SPELL_URL(id)}&xml`;
const ITEM_URL  = id => `https://www.wowhead.com/classic/item=${id}`;
const ITEM_XML  = id => `${ITEM_URL(id)}&xml`;
const ICON_URL  = name => `https://wow.zamimg.com/images/wow/icons/large/${String(name)}.jpg`;

/*──────── helpers ─────*/
const dl = url =>
  fetch(url, { headers: { "user-agent": "EnchantPlanner/1.0" } }).then(r => r.text());

const scripts = html =>
  [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

const lvArray = block => {
  const start = block.indexOf("data:");
  const open  = block.indexOf("[", start);
  let depth = 0, i = open;
  for (; i < block.length; i++) {
    if (block[i] === "[") depth++;
    else if (block[i] === "]" && --depth === 0) break;
  }
  return vm.runInNewContext(block.slice(open, i + 1));
};

const reagentsMap = raw => {
  const out = {};
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const id  = r.id ?? r.itemId ?? r[0];
      const qty = r.qty ?? r.count ?? r[1];
      if (id && qty > 0) out[id] = qty;
    }
  } else if (raw && typeof raw === "object") {
    for (const [id, qty] of Object.entries(raw)) {
      if (qty > 0) out[id] = Number(qty);
    }
  }
  return out;
};

/*──────── spell‐icon download ────*/
const ICON_DIR = path.resolve("public/icons/enchanting");
async function ensureDir() {
  await fs.mkdir(ICON_DIR, { recursive: true });
}
async function downloadIcon(spellId, iconName) {
  const file = path.join(ICON_DIR, `${spellId}.jpg`);
  try {
    await fs.access(file);
    return;
  } catch {}
  console.log(`⇩  downloading spell icon ${spellId} (${iconName})`);
  const res = await fetch(ICON_URL(iconName), {
    headers: { "user-agent": "EnchantPlanner/1.0" }
  });
  if (!res.ok) {
    console.warn(`⚠️  spell icon ${iconName} (${spellId}) failed ${res.status}`);
    return;
  }
  const buf = await res.buffer();
  await fs.writeFile(file, buf);
}

/*──────── level resolvers ────*/
async function levelFromItem(itemId) {
  const xml = await dl(ITEM_XML(itemId));
  const xmlLvl = xml.match(/skilllevel="(\d+)"/i);
  if (xmlLvl && +xmlLvl[1] > 0) return +xmlLvl[1];

  const html = await dl(ITEM_URL(itemId));
  const head = html.match(/Requires Enchanting \((\d+)\)/i);
  if (head) return +head[1];

  const blob = html.match(/"reqskillrank"\s*:\s*(\d+)/i);
  if (blob && +blob[1] > 0) return +blob[1];

  return null;
}

async function levelInfoForSpell(spellId) {
  // 1) XML
  const xml = await dl(SPELL_XML(spellId));
  const req = xml.match(/<skillLine[^>]*reqskill="(\d+)"/i);
  if (req && +req[1] > 0) return { level: +req[1], colors: parseSkillup(xml) };

  // 2) HTML listviews
  const html = await dl(SPELL_URL(spellId));
  const lvBlocks = scripts(html).filter(s =>
    s.includes("template: 'trainer'") ||
    (s.includes("template: 'item'") && (s.includes("taught") || s.includes("learnedfrom-item")))
  );
  let min = Infinity;
  for (const b of lvBlocks) {
    const vals = [...b.matchAll(/"skill"\s*:\s*(\d+)/g)].map(m => +m[1]);
    const best = Math.min(...vals.filter(v => v > 0));
    if (isFinite(best) && best < min) min = best;
  }
  if (isFinite(min)) return { level: min };

  // 3) Recipe items
  const itemIds = [...xml.matchAll(/<item id="(\d+)"/g)].map(m => m[1]);
  for (const id of itemIds) {
    const lvl = await levelFromItem(id);
    if (lvl) return { level: lvl };
  }

  // 4) any reqskillrank
  const rank = html.match(/"reqskillrank"\s*:\s*(\d+)/i);
  if (rank && +rank[1] > 0) return { level: +rank[1] };

  return null;
}

const parseSkillup = xml => {
  const m = xml.match(/skillup="([\d,]+)"/i);
  if (!m) return [null, null, null];
  const arr = m[1].split(",").map(Number);
  return arr.length >= 4 ? arr.slice(1, 4) : [null, null, null];
};

/*─── fallback icon from spell row ───*/
async function getIconName(spellRow) {
  if (spellRow.icon) return String(spellRow.icon);
  const xml = await dl(SPELL_XML(spellRow.id));
  const ix = xml.match(/<icon id="(\d+)"/i);
  if (ix) return ix[1];
  const html = await dl(SPELL_URL(spellRow.id));
  const hc = html.match(/Icon\.create\("([^"]+)",/);
  if (hc) return hc[1];
  return null;
}

/*─── material icons download ───*/
const MAT_ICON_DIR = path.resolve("public/icons/materials");
async function ensureMaterialDir() {
  await fs.mkdir(MAT_ICON_DIR, { recursive: true });
}
async function downloadMaterialIcon(itemId, iconName) {
  console.debug(`[ICON] downloadMaterialIcon(${itemId}, ${iconName})`);
  const file = path.join(MAT_ICON_DIR, `${itemId}.jpg`);
  try {
    await fs.access(file);
    console.debug(`[ICON] exists → ${file}`);
    return;
  } catch {
    console.debug(`[ICON] not found → ${file}`);
  }
  console.log(`⇩  downloading material icon ${itemId} (${iconName})`);
  const res = await fetch(ICON_URL(iconName), {
    headers: { "user-agent": "EnchantPlanner/1.0" }
  });
  console.debug(`[ICON] status=${res.status}`);
  if (!res.ok) {
    console.warn(`⚠️  material icon ${iconName} (${itemId}) failed ${res.status}`);
    return;
  }
  const buf = await res.buffer();
  console.debug(`[ICON] got ${buf.length} bytes`);
  await fs.writeFile(file, buf);
}

;(async () => {
  console.log('🚀 Starting Enchanting scraper…');
  console.time('Total runtime');

  await ensureDir();
  await ensureMaterialDir();

  console.log("⏳  [1/3] Downloading profession list…");
  const profHtml = await dl(PROF_URL);
  console.log("✅  Profession page downloaded");

  const spellBlock = scripts(profHtml).find(s => s.includes("template: 'spell'"));
  if (!spellBlock) throw new Error("spell list-view not found");

  const spells = lvArray(spellBlock);
  console.log(`✅  Found ${spells.length} spells`);

  // Load existing recipes
  const recipeFile = path.resolve("src/data/recipes/enchanting.json");
  let knownIds = new Set();
  let existingRecipes = [];
  try {
    existingRecipes = JSON.parse(await fs.readFile(recipeFile, "utf8"));
    existingRecipes.forEach(r => knownIds.add(r.id));
    console.log(`🔄  Loaded ${existingRecipes.length} existing recipes (skipping duplicates)`);
  } catch {
    console.log("🔄  No existing recipes file, scraping all");
  }

  console.log("🔄  [2/3] Processing spells into recipes…");
  const out = [];
  for (const [idx, sp] of spells.entries()) {
    if (knownIds.has(sp.id)) {
      console.log(`↪  Skipping known recipe ${sp.id}: "${sp.name}"`);
      continue;
    }
    console.log(`  🔍 [${idx+1}/${spells.length}] Spell ${sp.id}: "${sp.name}"`);
    let orange = sp.colors?.[0] > 0 ? sp.colors[0] : null;
    let min    = sp.reqskill || sp.learnedat || null;
    let [yellow, green, gray] =
      [sp.colors?.[1] ?? null, sp.colors?.[2] ?? null, sp.colors?.[3] ?? null];

    if (!orange) {
      const info = await levelInfoForSpell(sp.id);
      if (!info && (sp.id === 7418 || sp.id === 7428)) {
        orange = min = 1;
      } else if (!info) {
        console.log(`⤬ skipped ${sp.id} – cannot determine level`);
        continue;
      } else {
        orange = min = info.level;
        if (info.colors) [yellow, green, gray] = info.colors;
      }
    }

    // download spell icon
    const iconName = await getIconName(sp);
    if (iconName) {
      await downloadIcon(sp.id, iconName);
    }

    out.push({
      id:         sp.id,
      name:       sp.name,
      quality:    sp.quality,    // ← record the recipe’s quality
      minSkill:   min,
      difficulty: { orange, yellow, green, gray },
      materials:  reagentsMap(sp.reagents ?? sp.reagent ?? {}),
    });
    console.log(`   ✔ added recipe ${sp.id} (total ${out.length})`);
  }

  // Save recipes
  console.log("📦 Writing enchanting.json…");
  await fs.mkdir(path.dirname(recipeFile), { recursive: true });
  if (out.length === 0) {
    console.log("⚠️  No new recipes found—skipping write to enchanting.json");
  } else {
    await fs.writeFile(recipeFile, JSON.stringify(out, null, 2), "utf8");
    console.log(`✅  Saved ${out.length} new recipes → ${recipeFile}`);
  }

  // Combine all recipes for materials
  const allRecipes = existingRecipes.concat(out);
  console.log(`🔎  Preparing materials from ${allRecipes.length} total recipes`);

  // ─── MATERIAL SCRAPE (parallel) ─────────────────────────────
  console.log("⏳  [3/3] Resolving material names & icons…");
  const matSet = new Set();
  allRecipes.forEach(r => Object.keys(r.materials).forEach(id => matSet.add(id)));
  const matIds = [...matSet];
  console.log(`   Found ${matIds.length} unique materials`);

  const tradeMatFile = path.resolve("src/data/materials/tradeMaterials.json");
  let existingMatMap = {};
  let matMap = {};

  try {
    existingMatMap = JSON.parse(await fs.readFile(tradeMatFile, "utf8"));
    console.log(`🔄  loaded ${Object.keys(existingMatMap).length} existing materials`);
    matMap = { ...existingMatMap };
  } catch {
    console.log("🔄  no existing tradeMaterials.json, will build fresh");
    matMap = {};
  }

  

  const tasks = matIds.map((id, idx) => limit(async () => {

    if (matMap[id]) {
        console.log(`↪  skipping material ${id}, already have info`);
        return;
    }

    console.log(`    🔍 [${idx+1}/${matIds.length}] Material ${id}`);
    let xml;
    try {
        xml = await dl(ITEM_XML(id));
    } catch (e) {
        console.warn(`     ✖  failed XML for ${id}`, e);
        matMap[id] = { name: `Item ${id}`, quality: null };
        return;
    }

      const m = xml.match(/<name><!\[CDATA\[(.*?)\]\]><\/name>/i);
      const name = m?.[1] ?? `Item ${id}`;

      // quality from XML: <quality id="2">Uncommon</quality>
      const mQual = xml.match(/<quality\s+id="(\d+)"/i);
      const quality = mQual ? Number(mQual[1]) : null;

      matMap[id] = {
        name,
        quality
      };

      console.log(`     ✔  name → "${name}"`);

      // extract icon name
      let iconName = null;
      const iconMatch = xml.match(
        /<icon\b[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|([^<]+))<\/icon>/i
        );

        if (iconMatch) {
            // prefer the CDATA capture group[1], else group[2]
            iconName = iconMatch[1] || iconMatch[2];
            console.debug(`[MATERIAL ${id}] xml‐icon → "${iconName}"`);
        } else {
            console.debug(`[MATERIAL ${id}] no <icon> tag in XML, fetching HTML fallback`);
            const html = await dl(ITEM_URL(id));
            const ic = html.match(/Icon\.create\("([^"]+)",/);
            if (ic?.[1]) {
                iconName = ic[1];
                console.debug(`[MATERIAL ${id}] html Icon.create → "${iconName}"`);
            } else {
                console.debug(`[MATERIAL ${id}] html fallback: checking background-image`);
                const bg = html.match(/ins[^>]+style="background-image:\\s*url\\\("([^"]+)"/);
                if (bg?.[1]) {
                    const parts = bg[1].split("/");
                    iconName = parts.pop().replace(/\.(png|jpg)$/, "");
                    console.debug(`[MATERIAL ${id}] html bg‐image → "${iconName}"`);
                }
            }
        }

    if (iconName) {
        await downloadMaterialIcon(id, iconName);
    }
    }));

    console.log("   ⏳  running all material tasks…");
    await Promise.all(tasks);
    console.log(`   ✅ material tasks complete; matMap now has ${Object.keys(matMap).length} entries`);

  // Save materials
  const matFile = path.resolve("src/data/materials/tradeMaterials.json");
  console.log("📦 Writing tradeMaterials.json…");
  await fs.mkdir(path.dirname(matFile), { recursive: true });
  await fs.writeFile(matFile, JSON.stringify(matMap, null, 2), "utf8");
  console.log(`✅  Saved ${matIds.length} materials → ${matFile}`);

  console.timeEnd('Total runtime');
  console.log('🎉 Enchanting scrape complete!');
})();