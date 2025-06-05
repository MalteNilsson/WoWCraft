// src/scripts/scrape_all_professions.js

import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import puppeteer from 'puppeteer';
import { parseStringPromise } from 'xml2js';

const streamPipeline = promisify(pipeline);

const PROFESSIONS = [
  'alchemy',
  'blacksmithing',
  'enchanting',
  'engineering',
  'leatherworking',
  'tailoring',
];

const BASE_URL = 'https://www.wowhead.com/classic/spells/professions/';
const FILTER_QUERY = '?filter=20:21;1:5;0:11400';

const args = process.argv.slice(2); // Get command line args
const requestedProfession = args[0];

const globalMaterialIds = new Set();
const globalMaterialData = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const scrapeProfession = async (browser, profession) => {
  const page = await browser.newPage();
  console.log(`\n🔍 Scraping: ${profession}`);  

  const allRecipes = [];

  try {
    let offset = 0;
    let pageCount = 1;

    const firstTimeUrl = `${BASE_URL}${profession}${FILTER_QUERY}#0`;
    await page.goto(firstTimeUrl, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#lv-spells');


    const number_of_recipes = await page.$eval(
        '#lv-spells > div.listview-band-top > div.listview-nav > span > b:nth-child(3)',
        el => el.textContent.trim()
      );
      
    console.log("Number of Recipes:", number_of_recipes);

    while (offset<number_of_recipes) {
        const paginatedUrl = `${BASE_URL}${profession}${FILTER_QUERY}#${offset}`;
        console.log(`📄 Scraping page ${pageCount} → ${paginatedUrl}`);
        await page.goto(paginatedUrl, { waitUntil: 'networkidle0' });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('#lv-spells');

    
         await page.waitForFunction(() => {
            const span = document.querySelector('span.r1');
            return span && span.textContent.trim().length > 0;
        });
    
        const recipes = await page.evaluate(() => {
          const rows = document.querySelectorAll('#lv-spells tbody tr');
        
          return Array.from(rows).map((row, index) => {
            const tds = row.querySelectorAll('td');
            const anchor = tds[1]?.querySelector('a');
            if (!anchor) {
              console.warn(`⚠️ Row ${index} has no anchor`);
              return null;
            }
        
            const idMatch = anchor.href?.match(/spell=(\d+)/);
            const id = idMatch ? parseInt(idMatch[1]) : null;
            if (!id) {
              console.warn(`⚠️ Row ${index} has no spell ID`);
              return null;
            }
        
            const name = anchor.textContent?.trim() ?? '';
            const qualityMatch = anchor.className.match(/q(\d)/);
            const quality = qualityMatch ? parseInt(qualityMatch[1]) : 1;
        
            const diffContainer = tds[5]?.querySelector('div:nth-child(2)');
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
            if (!hasDifficulty) {
              console.warn(`⚠️ Row ${index} (ID ${id}) has no difficulty data — skipping`);
              return null;
            }
        
            // icon
            const iconUrl = tds[0]?.querySelector('ins')?.style?.backgroundImage || '';
            const iconMatch = iconUrl.match(/\/icons\/.+\/(.+?)\.jpg/);
            const icon = iconMatch ? iconMatch[1] : '';
        
            // materials
            const materials = {};
            const reagentDivs = tds[3]?.querySelectorAll('div') || [];
            reagentDivs.forEach(div => {
              const itemHref = div.querySelector('a')?.href;
              const match = itemHref?.match(/item=(\d+)/);
              const itemId = match ? match[1] : null;
        
              const quantitySpan = div.querySelector('span');
              const quantity = quantitySpan ? parseInt(quantitySpan.textContent.trim()) : 1;
        
              if (itemId) {
                materials[itemId] = quantity;
              }
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
        });


      console.log(`🔎 Found ${recipes.length} recipes on page ${pageCount}`);
      

      const pages = await Promise.all(recipes.map(() => browser.newPage()));
      
      try {
        // Process all recipes concurrently
        await Promise.all(recipes.map(async (recipe, index) => {
          const page = pages[index];
          
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
                // Check for trainer cost
                const moneySpan = document.querySelector('span.moneygold, span.moneysilver, span.moneycopper');
                let trainerCost = 0;
                
                if (moneySpan) {
                  const text = moneySpan.textContent.trim();
                  const amount = parseInt(text.replace(/[^\d]/g, ''));
                  
                  if (moneySpan.classList.contains('moneygold')) {
                    trainerCost = amount * 10000;
                  }
                  if (moneySpan.classList.contains('moneysilver')) {
                    trainerCost = amount * 100;
                  }
                  if (moneySpan.classList.contains('moneycopper')) {
                    trainerCost = amount;
                  }
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
      } finally {
        // Close all pages
        console.log('\n🧹 Cleaning up browser pages...');
        await Promise.all(pages.map(page => page.close()));
        console.log('✅ All pages closed');
      }

      allRecipes.push(...recipes);

      for (const recipe of recipes) {
        Object.keys(recipe.materials).forEach(id => {
          globalMaterialIds.add(id);
          globalMaterialData[id] = {
            name: "",
            quality: 1
          };
        });
      }


      pageCount++;
      offset += 50;
    }

    const outputDir = path.join(__dirname, '..', 'data', 'recipes');
    const outputPath = path.join(outputDir, `${profession}.json`);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(allRecipes, null, 2));

    console.log(`✅ Saved ${allRecipes.length} recipes → ${outputPath}`);
    return allRecipes;
  } catch (err) {
    console.error(`❌ Error scraping ${profession}:`, err.message);
    return [];
  } finally {
    await page.close();
  }
};

const enrichMaterialData = async () => {
    const materialPath = path.join(__dirname, '..', 'data', 'materials', 'materials.json');
    const raw = await fs.readFile(materialPath, 'utf-8');
    const materials = JSON.parse(raw);
  
    const materialIds = Object.keys(materials).filter(id => !materials[id].name);
    console.log(`🔄 Processing ${materialIds.length} materials in parallel...`);

    const results = await Promise.all(materialIds.map(async (id) => {
      const url = `https://www.wowhead.com/classic/item=${id}&xml`;
    
      let createdBy = null;
    
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

        const jsonEquipStr = item?.jsonEquip?.[0];
        let vendorPrice = null;

        if (typeof jsonEquipStr === 'string') {
          try {
            const json = JSON.parse(`{${jsonEquipStr}}`);
            vendorPrice = json.buyprice ?? null;
          } catch (e) {
            console.warn(`⚠️ Failed to parse jsonEquip for item ${id}`);
          }
        }
    
        // Icon
        let icon = '';
        const iconNode = item?.icon?.[0];
        if (typeof iconNode === 'string') {
          icon = iconNode.trim();
        } else if (typeof iconNode === 'object' && iconNode._) {
          icon = iconNode._.trim();
        }
    
        // createdBy parsing
        const spell = item?.createdBy?.[0]?.spell?.[0];
        if (spell) {
          const spellId = parseInt(spell.$?.id ?? '0');
          const spellName = spell.$?.name ?? '';
          const minCount = parseInt(spell.$?.minCount ?? '1');
          const maxCount = parseInt(spell.$?.maxCount ?? '1');
          const reagents = {};
          
          const rawReagents = spell.reagent ?? [];
          for (const reagent of rawReagents) {
            const rid = parseInt(reagent.$?.id ?? '0');
            const count = parseInt(reagent.$?.count ?? '1');
            if (rid > 0 && !isNaN(count)) {
              reagents[rid] = count;
            }
          }

          if (spellId && Object.keys(reagents).length > 0) {
            createdBy = {
              spellId,
              spellName,
              reagents,
              minCount,
              maxCount
            };
          }
        }
    
        // Return enriched data
        if (name) {
          return {
            id,
            data: {
              name,
              quality,
              class: itemClass,
              subclass,
              icon,
              slot,
              link,
              vendorPrice,
              ...(createdBy ? { createdBy } : {})
            }
          };
        }
    
      } catch (err) {
        console.warn(`❌ Error fetching item ${id}: ${err.message}`);
      }
    
      await new Promise(r => setTimeout(r, 250));
      return { id, data: null };
    }));

    // Update materials with enriched data
    results.forEach(result => {
      if (result && result.data) {
        materials[result.id] = result.data;
      }
    });
  
    await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
    console.log(`✅ Enrichment complete → ${materialPath}`);
  };


  const downloadMaterialIcons = async () => {
    const materialsPath = path.join(__dirname, '..', 'data', 'materials', 'materials.json');
    const projectRoot = path.join(__dirname, '..', '..');
    const iconDir = path.join(projectRoot, 'public', 'icons', 'materials');


    await fs.mkdir(iconDir, { recursive: true });

  
    const materials = JSON.parse(await fs.readFile(materialsPath, 'utf-8'));
  
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

  const downloadRecipeIcons = async (profession) => {
    const recipePath = path.join(__dirname, '..', 'data', 'recipes', `${profession}.json`);

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

const processRecipeItems = async (profession, recipes, browser) => {
  console.log(`\n📦 Processing recipe items for ${profession}...`);
  
  const recipeItems = {};
  
  try {
    // Get all unique recipe item IDs
    const recipeItemIds = new Set();
    recipes.forEach(recipe => {
      if (recipe.source?.type === 'item') {
        recipeItemIds.add(recipe.source.recipeItemId);
      }
    });
    
    const itemIds = Array.from(recipeItemIds);
    console.log(`Found ${itemIds.length} unique recipe items to process`);

    // Process all items in parallel
    console.log('🔄 Fetching XML data for all items...');
    const results = await Promise.all(itemIds.map(async (itemId) => {
      try {
        // Fetch XML data
        const xmlUrl = `https://www.wowhead.com/classic/item=${itemId}&xml`;
        const xmlData = await fetch(xmlUrl)
          .then(response => response.text())
          .then(async xmlText => {
            const parsed = await parseStringPromise(xmlText);
            const item = parsed?.wowhead?.item?.[0];

            // Get the htmlTooltip content
            const htmlTooltip = item?.htmlTooltip?.[0];
            const tooltipContent = htmlTooltip || '';
            
            // Split by </table> to get the first table (recipe info)
            const firstTable = tooltipContent.split('</table>')[0];
            
            // Check for "Binds when picked up" text in the first table
            const isRecipeBoP = firstTable.includes('Binds when picked up');

            // Get vendor price from jsonEquip
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

            return {
              bop: isRecipeBoP,
              buyPrice
            };
          });

        // Fetch HTML data for limited stock info
        const htmlUrl = `https://www.wowhead.com/classic/item=${itemId}`;
        const htmlData = await fetch(htmlUrl)
          .then(response => response.text())
          .then(html => {
            const stockRegex = /\b[Ss]tock\b(?!ades)/;
            const hasStock = stockRegex.test(html);
            
            return {
              limitedStock: hasStock
            };
          })
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
    
    // Save the data
    const outputDir = path.join(__dirname, '..', 'data', 'recipes');
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

    const outputDirMaterials = path.join(__dirname, '..', 'data', 'materials');
    const materialPath = path.join(outputDirMaterials, 'materials.json');

    // Load existing materials if they exist
    try {
        const existing = await fs.readFile(materialPath, 'utf-8');
        const parsed = JSON.parse(existing);
        for (const id in parsed) {
            globalMaterialIds.add(id);
            globalMaterialData[id] = parsed[id];
        }
        console.log(`📦 Loaded ${Object.keys(parsed).length} existing materials from materials.json`);
    } catch {
        console.log(`📁 No existing materials.json found, starting fresh.`);
    }


  const browser = await puppeteer.launch({ headless: 'new' });

  if (requestedProfession) {
    if (!PROFESSIONS.includes(requestedProfession)) {
      console.error(`❌ Invalid profession: ${requestedProfession}`);
      console.log(`➡️ Valid options: ${PROFESSIONS.join(', ')}`);
      await browser.close();
      process.exit(1);
    }
    const recipes = await scrapeProfession(browser, requestedProfession);
    await processRecipeItems(requestedProfession, recipes, browser);
  } else {
    for (const profession of PROFESSIONS) {
      const recipes = await scrapeProfession(browser, profession);
      await processRecipeItems(profession, recipes, browser);
    }
    console.log(`\n🎉 All professions scraped successfully.`);  
  }
  
  // ✅ Write materials.json in all cases
  await fs.mkdir(outputDirMaterials, { recursive: true });
  await fs.writeFile(materialPath, JSON.stringify(globalMaterialData, null, 2));
  
  console.log(`✅ Saved ${Object.keys(globalMaterialData).length} unique materials → ${materialPath}`);

  // ✅ Enrich it with WoWHead XML data
  await enrichMaterialData(materialPath);

  await downloadMaterialIcons();

  for (const profession of requestedProfession ? [requestedProfession] : PROFESSIONS) {
    await downloadRecipeIcons(profession);
  }

  await browser.close();
})();