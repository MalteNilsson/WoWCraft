/* eslint-disable no-console */
const fetch = require("node-fetch");               // npm i node-fetch@2

const SPELL_XML = id => `https://www.wowhead.com/classic/spell=${id}&xml`;
const ITEM_XML  = id => `https://www.wowhead.com/classic/item=${id}&xml`;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "XML-Debug/1.0" } });
  return res.text();
}

(async () => {
  const spellId = process.argv[2];
  if (!spellId) {
    console.error("Usage: node debug_xml.js <spellId>");
    process.exit(1);
  }

  /* ── Spell XML ── */
  const spellXml = await fetchText(SPELL_XML(spellId));
  console.log(spellXml.trim());           // spell XML only
  console.log("\n");                      // separator

  /* ── Any recipe-item XML ── */
  const itemIds = [...spellXml.matchAll(/<item id="(\d+)"/g)].map(m => m[1]);

  for (const id of itemIds) {
    const itemXml = await fetchText(ITEM_XML(id));
    console.log(itemXml.trim());          // item XML only
    console.log("\n");                    // separator
  }
})();