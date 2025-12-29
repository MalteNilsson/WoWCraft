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

// Parse command line arguments
const phases = {
  scrape: true,
  enrich: true,
  downloadIcons: true
};

let requestedProfession = null;

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
      
      const phaseList = phaseArg.split(',');
      phaseList.forEach(phase => {
        const trimmed = phase.trim();
        if (trimmed === 'scrape') phases.scrape = true;
        if (trimmed === 'enrich') phases.enrich = true;
        if (trimmed === 'icons' || trimmed === 'downloadIcons') phases.downloadIcons = true;
      });
      i++; // Skip next arg as it's the phase value
    }
  } else if (arg === '--profession' || arg === '-prof') {
    requestedProfession = args[i + 1];
    i++; // Skip next arg as it's the profession value
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
  --phase <phases>     Run only specified phases (comma-separated)
                       Available phases: scrape, enrich, icons
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

const enrichMaterialData = async (browser) => {
    const materialPath = path.join(__dirname, '..', 'data', 'materials', 'materials.json');
    const recipesDir = path.join(__dirname, '..', 'data', 'recipes');
    
    let materials = {};
    
    // Try to load existing materials.json
    try {
        const raw = await fs.readFile(materialPath, 'utf-8');
        materials = JSON.parse(raw);
        console.log(`📦 Loaded ${Object.keys(materials).length} existing materials from materials.json`);
    } catch (err) {
        // If materials.json doesn't exist, rebuild it from recipe files
        console.log(`📁 materials.json not found. Rebuilding from recipe files...`);
        
        try {
            const recipeFiles = await fs.readdir(recipesDir);
            const jsonFiles = recipeFiles.filter(f => f.endsWith('.json') && !f.includes('_items'));
            
            for (const file of jsonFiles) {
                const filePath = path.join(recipesDir, file);
                const recipes = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                
                // Extract all material IDs from recipes
                recipes.forEach(recipe => {
                    Object.keys(recipe.materials || {}).forEach(id => {
                        if (!materials[id]) {
                            materials[id] = {
                                name: "",
                                quality: 1
                            };
                        }
                    });
                });
            }
            
            console.log(`📦 Rebuilt materials.json with ${Object.keys(materials).length} materials from recipe files`);
            
            // Save the rebuilt materials.json
            await fs.mkdir(path.dirname(materialPath), { recursive: true });
            await fs.writeFile(materialPath, JSON.stringify(materials, null, 2));
        } catch (rebuildErr) {
            console.error(`❌ Failed to rebuild materials.json: ${rebuildErr.message}`);
            throw new Error('Cannot enrich materials: materials.json missing and cannot be rebuilt');
        }
    }
  
    // Filter for materials that need enrichment: empty name or missing name
    const materialIds = Object.keys(materials).filter(id => {
      const mat = materials[id];
      return !mat.name || mat.name === "" || mat.name.trim() === "";
    });
    console.log(`🔄 Processing ${materialIds.length} materials for enrichment...`);
    
    if (materialIds.length === 0) {
      console.log(`✅ All materials already enriched. Nothing to process.`);
      return;
    }

    // Process materials sequentially to avoid overwhelming the browser
    let processed = 0;
    console.log(`  Starting to process materials...`);
    
    for (const id of materialIds) {
      processed++;
      console.log(`  [${processed}/${materialIds.length}] Processing item ${id}...`);
      
      if (processed % 10 === 0) {
        console.log(`  Progress: ${processed}/${materialIds.length} materials processed...`);
      }
      
      const url = `https://www.wowhead.com/classic/item=${id}&xml`;
    
      let createdBy = null;
      let limitedStock = false;
    
      try {
        // Fetch XML data
        console.log(`    Fetching XML for item ${id}...`);
        const response = await fetch(url);
        console.log(`    XML fetched for item ${id}, parsing...`);
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

        // Check for limited stock using Puppeteer (only if item has vendor price)
        if (vendorPrice !== null && browser) {
          try {
            console.log(`    Checking limited stock for item ${id} (vendor price: ${vendorPrice})...`);
            const page = await browser.newPage();
            const itemUrl = `https://www.wowhead.com/classic/item=${id}#sold-by`;
            
            console.log(`    Navigating to ${itemUrl}...`);
            // Use a shorter timeout and don't wait for networkidle0 (faster)
            await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            console.log(`    Page loaded for item ${id}, checking vendor table...`);
            
            // Wait for vendor table to load (if it exists) with shorter timeout
            try {
              await page.waitForSelector('table.listview-mode-default tbody tr.listview-row', { timeout: 3000 });
            } catch (e) {
              // Table might not exist if item isn't sold by vendors - this is fine
            }

            // Parse vendor table to check for limited stock AND verify price is in currency
            const vendorInfo = await page.evaluate(() => {
              const vendorTable = document.querySelector('table.listview-mode-default');
              if (!vendorTable) return { limitedStock: false, hasCurrencyPrice: false };

              const rows = vendorTable.querySelectorAll('tbody tr.listview-row');
              if (rows.length === 0) return { limitedStock: false, hasCurrencyPrice: false };

              let hasCurrencyPrice = false;
              let limitedStock = false;

              // Check each row
              for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 7) {
                  // Check Cost column (7th column, index 6)
                  const costCell = cells[6];
                  if (costCell) {
                    // Check if price contains currency classes (moneygold, moneysilver, moneycopper)
                    // Exclude moneyitem which indicates special currency items
                    const hasCurrency = costCell.querySelector('.moneygold, .moneysilver, .moneycopper') !== null;
                    const hasItemCurrency = costCell.querySelector('.moneyitem') !== null;
                    
                    if (hasCurrency && !hasItemCurrency) {
                      hasCurrencyPrice = true;
                      
                      // Check Stock column (5th column, index 4) - only for currency vendors
                      const stockCell = cells[4];
                      if (stockCell) {
                        const stockText = stockCell.textContent.trim();
                        
                        // If stock is not ∞ (infinity), it's limited stock
                        if (stockText !== '∞' && stockText !== '' && !isNaN(parseInt(stockText))) {
                          limitedStock = true;
                        }
                      }
                    }
                  }
                }
              }
              
              return { limitedStock, hasCurrencyPrice };
            });

            // If no vendors have currency prices, clear vendorPrice
            if (!vendorInfo.hasCurrencyPrice) {
              vendorPrice = null;
              limitedStock = false;
              console.log(`    ⚠️ Item ${id} has only non-currency vendor prices (reputation/token/etc), clearing vendor price`);
            } else {
              limitedStock = vendorInfo.limitedStock;
            }

            await page.close();
          } catch (err) {
            console.warn(`⚠️ Failed to check limited stock for item ${id}: ${err.message}`);
            limitedStock = false;
          }
        }
    
        // Save enriched data (only if we got a name from XML)
        if (name && name.trim() !== "") {
          materials[id] = {
            name,
            quality,
            class: itemClass,
            subclass,
            icon,
            slot,
            link,
            vendorPrice,
            ...(limitedStock ? { limitedStock: true } : {}),
            ...(createdBy ? { createdBy } : {})
          };
          console.log(`    ✅ Enriched item ${id}: ${name}`);
        } else {
          console.warn(`    ⚠️ No name found for item ${id}, skipping enrichment`);
        }
    
      } catch (err) {
        console.warn(`❌ Error fetching item ${id}: ${err.message}`);
      }
    
      // Small delay to avoid rate limiting (reduced from 500ms)
      await new Promise(r => setTimeout(r, 250));
    }
    
    console.log(`✅ Processed ${processed} materials`);
  
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

  // Phase 1: Scrape professions
  if (phases.scrape) {
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
    
    // ✅ Write materials.json after scraping
    await fs.mkdir(outputDirMaterials, { recursive: true });
    await fs.writeFile(materialPath, JSON.stringify(globalMaterialData, null, 2));
    console.log(`✅ Saved ${Object.keys(globalMaterialData).length} unique materials → ${materialPath}`);
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
    for (const profession of professionsToProcess) {
      await downloadRecipeIcons(profession);
    }
  } else {
    console.log(`⏭️  Skipping icon download phase`);
  }

  await browser.close();
  console.log(`\n✅ All selected phases complete!`);
})();