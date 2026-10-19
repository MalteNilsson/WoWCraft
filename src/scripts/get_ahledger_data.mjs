import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '../data/prices');

// AHledger price table: https://ahledger.com/developers
// Header: AHL1|market|unixSeconds|rowCount
// Row: itemId:median:minBuyout:quantity:median7d:median30d:low30d:high30d:salesPerDayTimes10
// Prices are copper. An empty field means unknown.
const MARKETS = [
  {
    id: 'forever.normal.alliance.us',
    file: 'ForeverNormal_alliance.json',
    ageKey: 'Forever Normal_Alliance',
  },
  {
    id: 'forever.normal.horde.us',
    file: 'ForeverNormal_horde.json',
    ageKey: 'Forever Normal_Horde',
  },
  {
    id: 'forever.pvp.alliance.us',
    file: 'ForeverPvP_alliance.json',
    ageKey: 'Forever PvP_Alliance',
  },
  {
    id: 'forever.pvp.horde.us',
    file: 'ForeverPvP_horde.json',
    ageKey: 'Forever PvP_Horde',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPriceTable(marketId) {
  const url = `https://api.ahledger.com/v1/pricetable/${marketId}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: 'text/plain', 'User-Agent': 'wowcraft-price-fetch' },
    });
    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after')) || 5;
      console.log(`  ${marketId} answered ${response.status}, retrying in ${retryAfter}s`);
      await sleep((retryAfter + 1) * 1000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  throw new Error('rate limited');
}

function parsePriceTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.split('|') ?? [];
  if (header[0] !== 'AHL1' || header.length < 4) {
    throw new Error(`unexpected price table: ${lines[0]?.slice(0, 80) ?? '(empty)'}`);
  }

  const scannedAt = new Date(Number(header[2]) * 1000);
  if (Number.isNaN(scannedAt.getTime())) {
    throw new Error(`invalid scan time: ${header[2]}`);
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const [itemId, median, minBuyout, quantity] = line.split(':');
    const id = Number(itemId);
    const min = minBuyout === '' || minBuyout === undefined ? NaN : Number(minBuyout);
    const med = median === '' || median === undefined ? NaN : Number(median);
    const buyout = Number.isFinite(min) ? min : med;
    const market = Number.isFinite(med) ? med : buyout;
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(buyout)) continue;
    const listed = quantity === '' || quantity === undefined ? 0 : Number(quantity);
    rows.push({
      itemId: id,
      minBuyout: buyout,
      marketValue: market,
      numAuctions: Number.isFinite(listed) ? listed : 0,
    });
  }

  rows.sort((a, b) => a.itemId - b.itemId);
  return { scannedAt, expected: Number(header[3]) || rows.length, rows };
}

async function main() {
  const agePath = path.join(outputDir, 'forever_price_age.json');
  const age = fs.existsSync(agePath)
    ? JSON.parse(fs.readFileSync(agePath, 'utf8'))
    : {};

  let failed = 0;

  for (const market of MARKETS) {
    try {
      console.log(`Fetching ${market.id}...`);
      const text = await fetchPriceTable(market.id);
      const { scannedAt, expected, rows } = parsePriceTable(text);
      if (rows.length === 0) {
        throw new Error(`no priced rows (header said ${expected})`);
      }

      const filepath = path.join(outputDir, market.file);
      fs.writeFileSync(filepath, JSON.stringify(rows));
      age[market.ageKey] = scannedAt.toISOString();
      console.log(`  ${rows.length} items, scanned ${scannedAt.toISOString()} → ${market.file}`);
    } catch (error) {
      failed += 1;
      console.error(`  failed ${market.id}: ${error.message}`);
    }
  }

  fs.writeFileSync(agePath, `${JSON.stringify(age, null, 2)}\n`);

  if (failed > 0) {
    console.error(`\n${failed} of ${MARKETS.length} markets failed. Existing files for those markets were left as they were.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nForever prices updated from AHledger.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
