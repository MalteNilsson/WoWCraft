import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;  // now always defined
  console.log(`[API] → GET /api/item-info/${id}`);

  // Fetch the XML
  const res = await fetch(`https://www.wowhead.com/classic/item=${id}&xml`);
  console.log(`[API]   fetched XML, status=${res.status}`);
  const txt = await res.text();

  // Parse the <name><![CDATA[...]]></name>
  let name: string;
  const nameMatch = txt.match(/<name><!\[CDATA\[(.*?)\]\]><\/name>/i);
  if (nameMatch && nameMatch[1]) {
    name = nameMatch[1];
  } else {
    const loose = txt.match(/<name>(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?<\/name>/i);
    name = loose ? loose[1].trim() : `Item ${id}`;
  }
  console.log(`[API]   parsed name:`, name);

  // Parse the <icon>inv_...<\/icon>
  let icon: string | null = null;
  // try strict CDATA first
  const iconCData = txt.match(/<icon><!\[CDATA\[(.*?)\]\]><\/icon>/i);
  if (iconCData && iconCData[1]) {
    icon = iconCData[1];
  } else {
    // loose fallback (handles both CDATA-wrapped or plain)
    const iconLoose = txt.match(/<icon>(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?<\/icon>/i);
    icon = iconLoose ? iconLoose[1].trim() : null;
  }
  console.log(`[API]   parsed icon:`, icon);

  console.log(`[API] ← responding { name: "${name}", icon: ${icon} }`);
  return NextResponse.json({ name, icon });
}