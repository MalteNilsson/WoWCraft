/* eslint-disable no-console */
const fetch = require("node-fetch");            // v2
const fs    = require("fs/promises");
const path  = require("path");
const vm    = require("vm");

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
  let d = 0, i = open;
  for (; i < block.length; i++) {
    if (block[i] === "[") d++;
    else if (block[i] === "]" && --d === 0) break;
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
    Object.entries(raw).forEach(([id, qty]) => {
      if (qty > 0) out[id] = Number(qty);
    });
  }
  return out;
};

/*──────── icon download ────*/
const ICON_DIR = path.resolve("public/icons/enchanting");
async function ensureDir() {
  await fs.mkdir(ICON_DIR, { recursive: true });
}
async function downloadIcon(spellId, iconName) {
  const file = path.join(ICON_DIR, `${spellId}.jpg`);
  try {
    await fs.access(file); // exists
    return;
  } catch {/* not found -> download */}
  console.log(`⇩  icon ${spellId} (${iconName})`);
  const res = await fetch(ICON_URL(iconName), {
    headers: { "user-agent": "EnchantPlanner/1.0" }
  });
  if (!res.ok) {
    console.warn(`⚠️  icon ${iconName} (${spellId}) failed ${res.status}`);
    return;
  }
  const buf = await res.buffer();
  await fs.writeFile(file, buf);
}

/*──────── item-level resolver ────*/
async function levelFromItem(itemId) {
  /* XML */
  const xml = await dl(ITEM_XML(itemId));
  const xmlLvl = xml.match(/skilllevel="(\d+)"/i);
  if (xmlLvl && +xmlLvl[1] > 0) return +xmlLvl[1];

  /* HTML header */
  const html = await dl(ITEM_URL(itemId));
  const head = html.match(/Requires Enchanting \((\d+)\)/i);
  if (head) return +head[1];

  /* Gatherer blob in item HTML */
  const blob = html.match(/"reqskillrank"\s*:\s*(\d+)/i);
  if (blob && +blob[1] > 0) return +blob[1];

  return null;
}

/*──────── spell-level resolver ───*/
async function levelInfoForSpell(spellId) {
  /* 1️⃣ spell XML */
  const xml = await dl(SPELL_XML(spellId));
  const req = xml.match(/<skillLine[^>]*reqskill="(\d+)"/i);
  if (req && +req[1] > 0) return { level: +req[1], colors: parseSkillup(xml) };

  /* 2️⃣ trainer / taught-by item list-views in HTML */
  const html = await dl(SPELL_URL(spellId));
  const lvBlocks = scripts(html).filter(
    s =>
      (s.includes("template: 'trainer'")) ||
      (s.includes("template: 'item'") &&
       (s.includes("taught") || s.includes("learnedfrom-item")))
  );
  let min = Infinity;
  for (const b of lvBlocks) {
    const values = [...b.matchAll(/"skill"\s*:\s*(\d+)/g)].map(m => +m[1]);
    const best   = Math.min(...values.filter(v => v > 0));
    if (isFinite(best) && best < min) min = best;
  }
  if (isFinite(min)) return { level: min };

  /* 3️⃣ recipe items */
  const itemIds = [...xml.matchAll(/<item id="(\d+)"/g)].map(m => m[1]);
  for (const id of itemIds) {
    const lvl = await levelFromItem(id);
    if (lvl) return { level: lvl };
  }

  /* 4️⃣ any reqskillrank inside ANY script */
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

/* ───────── 1) helper to guarantee an icon name ───────── */
async function getIconName(spellRow) {
    if (spellRow.icon) return String(spellRow.icon);           // most rows
  
    /* Fallback A – spell XML has <icon id="135913"/> */
    const xml = await dl(SPELL_XML(spellRow.id));
    const iconXml = xml.match(/<icon id="(\d+)"/i);
    if (iconXml) return iconXml[1];
  
    /* Fallback B – spell HTML `Icon.create("inv_misc_note_01", …)` */
    const html = await dl(SPELL_URL(spellRow.id));
    const iconHtml = html.match(/Icon\.create\("([^"]+)",/);
    if (iconHtml) return iconHtml[1];
  
    return null;                                              // give up
  }

/*──────── main scrape ─────────*/
(async () => {
    await ensureDir();
  
    console.log("⏳  downloading profession list …");
    const profHtml = await dl(PROF_URL);
    const spellBlock = scripts(profHtml).find(s => s.includes("template: 'spell'"));
    if (!spellBlock) throw new Error("spell list-view not found");
  
    const spells = lvArray(spellBlock);
    const out    = [];
  
    for (const sp of spells) {
      let orange = sp.colors?.[0] > 0 ? sp.colors[0] : null;
      let min    = sp.reqskill || sp.learnedat || null;
      let [yellow, green, gray] =
        [sp.colors?.[1] ?? null, sp.colors?.[2] ?? null, sp.colors?.[3] ?? null];
  
      if (!orange) {
        const info = await levelInfoForSpell(sp.id);
        if (!info && (sp.id === 7418 || sp.id === 7428)) {
          orange = min = 1;
        } else if (!info) {
          console.log(`⤬ skipped ${sp.id} – cannot determine learn level`);
          continue;
        } else {
          orange = min = info.level;
          if (info.colors) [yellow, green, gray] = info.colors;
        }
      }
  
      /* download icon once */
      const iconName = await getIconName(sp);
      if (iconName) {
        await downloadIcon(sp.id, iconName);
      }
  
      out.push({
        id:         sp.id,
        name:       sp.name,
        minSkill:   min,
        difficulty: { orange, yellow, green, gray },
        materials:  reagentsMap(sp.reagents ?? sp.reagent ?? {}),
      });
    }
  
    const file = path.resolve("src/data/recipes/enchanting.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(out, null, 2), "utf8");
    console.log(`✅  saved ${out.length} recipes → ${file}`);
  })();