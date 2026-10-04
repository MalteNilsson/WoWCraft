import fetchSummary from '@/data/prices/fetch_summary_anniversary.json';

const fetchedAt = new Date(fetchSummary.timestamp);

export const auctionDataUpdatedLabel = fetchedAt.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

export const auctionRealms = [
  'Thunderstrike',
  'Spineshatter',
  'Soulseeker',
  'Dreamscythe',
  'Nightslayer',
  'Doomhowl',
] as const;

export type ProfessionGuide = {
  slug: string;
  name: string;
  expansions: string;
  card: string;
  metaDescription: string;
  lead: string;
  paragraphs: string[];
  considerations: string[];
};

export const professionGuides: ProfessionGuide[] = [
  {
    slug: 'alchemy',
    name: 'Alchemy',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Potions, elixirs, and flasks, with cooldown transmutes left out of the route.',
    metaDescription:
      'Plan a cost-effective Alchemy leveling route for WoW Classic and The Burning Crusade. Compare herb costs, vendor prices, and auction listings without cooldown transmutes.',
    lead:
      'The Alchemy planner builds a repeatable route of potions, elixirs, flasks, and oils from skill 1 to the cap. Cooldown transmutes are left out, so the path does not stop on a shared timer.',
    paragraphs: [
      'Vanilla Alchemy ends at 300. The Burning Crusade continues to 375, and the recipe list changes with the expansion you select. At each skill the planner estimates how many crafts a recipe needs before the next point, then keeps the sequence with the lowest expected cost.',
      'Auction House mode prices the finished potion or elixir from its listing and subtracts the herbs and vials. Material-cost mode ignores the sale price and only totals what the reagents cost. Vendor mode uses a vendor price when one exists. Disenchant mode does not help most Alchemy crafts, because potions, elixirs, and flasks cannot be disenchanted.',
    ],
    considerations: [
      'Vanilla and Burning Crusade transmutes are excluded, including the later Burning Crusade transmute spells.',
      'Crafts that require a rare limited reagent, such as Gurubashi Mojo Madness, are excluded.',
      'In profit-oriented modes, recipes with under a 10% chance to skill up are skipped so the route does not grind a craft that almost never grants a point.',
    ],
  },
  {
    slug: 'blacksmithing',
    name: 'Blacksmithing',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Weapons and armor from copper through fel iron, skipping quest and rare-material plans.',
    metaDescription:
      'Find a Blacksmithing leveling route for WoW Classic and The Burning Crusade. Compare bar and stone costs across vendor and auction prices, without quest-only plans.',
    lead:
      'The Blacksmithing planner turns plans into a shopping list of weapons and armor, from copper through thorium and, in The Burning Crusade, fel iron and adamantite. Plans that depend on a quest turn-in or a one-off rare material are omitted.',
    paragraphs: [
      'The route is scored the same way as the other professions: expected crafts to the next skill point, times the cost of bars, stones, and flux. You can level only the band you still need, for example 225 to 300, instead of restarting from 1.',
      'A few well-known plans stay off the route because they are not practical repeatable crafts. That list includes Elemental Sharpening Stone, Ornate Mithril Helm, Dark Iron Mail, Dark Iron Shoulders, Ironvine Belt, and the Burning Crusade Earthforged, Windforged, Stormforged, and Stoneforged pieces.',
    ],
    considerations: [
      'Vanilla caps at 300. The Burning Crusade caps at 375.',
      'The material tree shows when a bar is cheaper to buy than to smelt from ore, using the vendor or auction price you selected.',
      'Auction House mode drops items with almost no sales and items listed on fewer than four auctions, so a single odd listing does not steer the route.',
    ],
  },
  {
    slug: 'cooking',
    name: 'Cooking',
    expansions: 'The Burning Crusade',
    card: 'Meals priced from meat, fish, and spices, using the Burning Crusade recipe list.',
    metaDescription:
      'Plan Cooking from 1 to 375 in The Burning Crusade. Compare vendor ingredients with auction prices for meat, fish, and spices.',
    lead:
      'The Cooking planner levels you on meals rather than gear. The recipes loaded for this profession are the Burning Crusade list, from the starter meats and fish through the Outland dishes, up to skill 375.',
    paragraphs: [
      'Many Cooking reagents are sold by vendors. Vendor mode uses those prices directly. Material-cost mode and Auction House mode matter when a fish or cut of meat is cheaper, or more expensive, on the auction house than at the vendor.',
      'Cooked meals are not disenchanted. In Disenchant mode the planner falls back to the meal’s vendor sell price when it has one, and otherwise the cost matches the reagents. Auction House mode is what compares the listing price of the meal with the meat, fish, and spices.',
    ],
    considerations: [
      'Choose The Burning Crusade in the planner. The Vanilla Cooking recipe list is empty, so a Vanilla route has no crafts yet.',
      'The skill chart still shows the orange, yellow, and green chance bands, so you can see where a meal stops being a reliable skill-up.',
      'Switch realm and faction in the planner to reprice the same menu with that auction house.',
    ],
  },
  {
    slug: 'enchanting',
    name: 'Enchanting',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Formulas plus the runed rods each tier requires, from copper through eternium.',
    metaDescription:
      'Level Enchanting in WoW Classic and The Burning Crusade with runed rods included in the route. Compare dust and essence costs; scrolls are not vendored or disenchanted.',
    lead:
      'Enchanting routes include the runed rods you have to craft before later formulas will work. Scrolls and rods are priced from their materials and from auction listings. They are not given a vendor sell price or a disenchant value.',
    paragraphs: [
      'The planner inserts each rod when your skill range reaches it: Runed Copper, Silver, Golden, Truesilver, and Arcanite in Vanilla, then Runed Fel Iron, Adamantite, and Eternium in The Burning Crusade. The previous rod is treated as something you already made, so it is not charged again as a raw material on the next rod.',
      'Because an enchant scroll cannot be sold to a vendor or disenchanted, Vendor mode and Disenchant mode do not credit the enchant itself. Those modes are useful on professions that produce gear. For Enchanting, compare material cost with Auction House mode, which uses the listing price of the scroll or rod when the auction data has one.',
    ],
    considerations: [
      'Rod crafts are placed at the skill where the formula is learned, even when another enchant looks cheaper on paper.',
      'Dust, essences, and shards come from the material list. The route tells you how many of each the chosen formulas are expected to consume.',
      'Smoking Heart of the Mountain is excluded. It is not a repeatable leveling formula.',
    ],
  },
  {
    slug: 'engineering',
    name: 'Engineering',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Gadgets, goggles, and ammo, with the Arclight Spanner and Gyromatic Micro-Adjustor included.',
    metaDescription:
      'Plan an Engineering leveling route for WoW Classic and The Burning Crusade, including required tools and excluding transporters, mortars, and dead-end schematics.',
    lead:
      'Engineering routes include the Arclight Spanner and the Gyromatic Micro-Adjustor when your skill range reaches them. Transporters, the Goblin Mortar, the Tranquil Mechanical Yeti, and several rocket schematics are left out.',
    paragraphs: [
      'The Arclight Spanner is inserted at skill 50 and the Gyromatic Micro-Adjustor at skill 175. They are tools the profession expects you to own, so the planner adds those crafts instead of assuming the tools appeared from nowhere.',
      'The omitted schematics are real recipes, but they are poor leveling steps: the Gadgetzan and Everlook transporters, Goblin Mortar, Tranquil Mechanical Yeti, and a run of rocket recipes. The route stays on goggles, explosives, ammunition, and gadgets you can repeat for skill points.',
    ],
    considerations: [
      'Vanilla ends at 300. The Burning Crusade adds the later schematics and raises the cap to 375.',
      'Parts, stone, and blasting powder are totaled in the shopping list for the whole skill band, not one craft at a time.',
      'Auction House mode ignores outputs listed on fewer than four auctions, which filters sparse gadget listings.',
    ],
  },
  {
    slug: 'jewelcrafting',
    name: 'Jewelcrafting',
    expansions: 'The Burning Crusade only',
    card: 'Gem cuts and jewelry from skill 1 to 375. Not available in Vanilla.',
    metaDescription:
      'Plan Jewelcrafting from 1 to 375 in The Burning Crusade. Compare gem cuts and jewelry by material cost and auction listings. Jewelcrafting is not in Vanilla.',
    lead:
      'Jewelcrafting is planned only for The Burning Crusade, from skill 1 to 375. The route is gem cuts and jewelry. Setting the planner to Vanilla removes Jewelcrafting, because the profession does not exist there.',
    paragraphs: [
      'Designs are scored by expected crafts per skill point and by the cost of the uncut gems and settings. Green and yellow difficulty still raises the number of expected crafts, so a cheap rare cut can lose to a common cut that skills up more often.',
      'Auction House mode compares the listing price of the cut gem or the finished jewel with the cost of the raw gem. Material-cost mode ignores that sale price. A cut with a huge apparent margin is rejected when the margin exceeds the outlier cap, so one mispriced gem does not dominate the route.',
    ],
    considerations: [
      'There is no Vanilla recipe set for Jewelcrafting. Open this page and leave the expansion on The Burning Crusade.',
      'The cap on this page is 375, matching Jewelcrafting in The Burning Crusade.',
      'Prospecting ore is not treated as a skill-up step in the route. The planner levels you on designs that grant Jewelcrafting skill.',
    ],
  },
  {
    slug: 'leatherworking',
    name: 'Leatherworking',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Armor, cloaks, and kits, with hides priced as buy or craft.',
    metaDescription:
      'Build a Leatherworking leveling route for WoW Classic and The Burning Crusade. Compare hide prices, cured leather, armor kits, and auction listings.',
    lead:
      'Leatherworking routes are armor, cloaks, and armor kits made from hides and leather. The material list compares crafting an intermediate leather with buying it when both a craft cost and a vendor or auction price exist.',
    paragraphs: [
      'From light leather through rugged and knothide, the planner follows the recipes that actually grant skill points inside the range you set. Armor kits show up when they are the cheaper expected skill-up, not only the finished chest or legs.',
      'Vendor mode is often the right check for salt and thread. Auction House mode matters for the hides themselves, which move more than the vendor reagents. Disenchant mode applies when the crafted piece can be disenchanted and you would rather price the dust than the armor.',
    ],
    considerations: [
      'Vanilla caps at 300. The Burning Crusade adds knothide and later patterns and caps at 375.',
      'Bind-on-pickup patterns that a vendor stocks in limited quantity are skipped, so the route does not depend on a recipe you can buy only once.',
      'The material list uses the cheaper of crafting a leather or buying it, when both a craft cost and a vendor or auction price exist.',
    ],
  },
  {
    slug: 'tailoring',
    name: 'Tailoring',
    expansions: 'Vanilla and The Burning Crusade',
    card: 'Bags and cloth armor, with bolts crafted as materials. Mooncloth is excluded.',
    metaDescription:
      'Plan Tailoring for WoW Classic and The Burning Crusade. Bolts of cloth are crafted into the shopping list, and Mooncloth is excluded as a cooldown.',
    lead:
      'Tailoring routes are bags and cloth armor. Mooncloth is excluded because it is a cooldown, not a step you can repeat for skill points.',
    paragraphs: [
      'Bolt of Linen Cloth, Bolt of Woolen Cloth, Bolt of Silk Cloth, Bolt of Mageweave, and Bolt of Runecloth are recipes, and they are also materials on later patterns. When a bolt can be crafted or bought, the cost uses whichever is cheaper.',
      'The planner compares bags and armor across the orange, yellow, and green bands and keeps the sequence with the lower expected cost for the skill range you chose. Vanilla ends at 300. The Burning Crusade continues through netherweave and the later cloths to 375.',
    ],
    considerations: [
      'Mooncloth is on the exclusion list. Do not expect it in a 250–300 or later band.',
      'Vanilla ends at 300. The Burning Crusade continues through netherweave and the later cloths to 375.',
      'Vendor mode prices dye and thread from vendors. Auction House mode reprices the cloth and the finished bags from listings.',
    ],
  },
];

const guidesBySlug = new Map(professionGuides.map((guide) => [guide.slug, guide]));

export function getProfessionGuide(slug: string): ProfessionGuide | undefined {
  return guidesBySlug.get(slug.toLowerCase());
}
