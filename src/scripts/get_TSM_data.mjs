import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TSM API configuration
const TSM_AUTH_URL = 'https://auth.tradeskillmaster.com/oauth2/token';
const TSM_BASE_URL = 'https://pricing-api.tradeskillmaster.com/ah';
const TSM_API_KEY = process.env.TSM_API_KEY; // Get API key from environment variable

// TSM OAuth2 client configuration
const TSM_CLIENT_ID = 'c260f00d-1071-409a-992f-dda2e5498536';

// Predefined realm lists
const REALM_LISTS = {
    'anniversary': [
        'Thunderstrike',
        'Spineshatter', 
        'Soulseeker',
        'Dreamscythe',
        'Nightslayer',
        'Doomhowl'
    ]
};

// Read realms data
const realmsPath = path.join(__dirname, '../data/prices/realms.json');
const realmsData = JSON.parse(fs.readFileSync(realmsPath, 'utf8'));

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '../data/prices');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Function to get access token from TSM
async function getAccessToken() {
    if (!TSM_API_KEY) {
        throw new Error('TSM_API_KEY environment variable is not set');
    }

    const tokenRequest = {
        client_id: TSM_CLIENT_ID,
        grant_type: 'api_token',
        scope: 'app:realm-api app:pricing-api',
        token: TSM_API_KEY
    };

    try {
        console.log('Getting access token from TSM...');
        
        const response = await fetch(TSM_AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tokenRequest)
        });

        if (!response.ok) {
            throw new Error(`Token request failed: ${response.status} - ${response.statusText}`);
        }

        const tokenData = await response.json();
        
        if (!tokenData.access_token) {
            throw new Error('No access token received from TSM');
        }

        console.log('✓ Access token obtained successfully');
        return tokenData.access_token;
    } catch (error) {
        console.error('✗ Failed to get access token:', error.message);
        throw error;
    }
}

// Function to fetch data from TSM API
async function fetchTSMData(auctionHouseId, realmName, faction, accessToken) {
    const url = `${TSM_BASE_URL}/${auctionHouseId}`;
    
    // Prepare headers with Bearer token
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };
    
    try {
        console.log(`Fetching data for ${realmName} (${faction}) - AH ID: ${auctionHouseId}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Save to file
        const filename = `${realmName}_${faction.toLowerCase()}.json`;
        const filepath = path.join(outputDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`✓ Saved data for ${realmName} (${faction})`);
        
        return data;
    } catch (error) {
        console.error(`✗ Error fetching data for ${realmName} (${faction}):`, error.message);
        return null;
    }
}

// Function to process specific realm list
async function processRealmList(realmListName) {
    console.log(`Starting TSM data fetch for realm list: ${realmListName}...\n`);
    
    // Get access token
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        console.error('❌ Failed to authenticate with TSM API');
        console.log('Please check your TSM_API_KEY environment variable');
        return;
    }
    
    const realmNames = REALM_LISTS[realmListName];
    if (!realmNames) {
        console.error(`❌ Unknown realm list: ${realmListName}`);
        console.log('Available realm lists:');
        Object.keys(REALM_LISTS).forEach(list => {
            console.log(`  - ${list}: ${REALM_LISTS[list].join(', ')}`);
        });
        return;
    }
    
    console.log(`Realms in ${realmListName}: ${realmNames.join(', ')}\n`);
    
    const results = [];
    
    // Process each realm in the list
    for (const realmName of realmNames) {
        console.log(`Processing realm: ${realmName}`);
        
        // Find the realm in the realms data
        let targetRealm = null;
        
        for (const region of realmsData.items) {
            for (const realm of region.realms) {
                if (realm.name === realmName) {
                    targetRealm = realm;
                    break;
                }
            }
            if (targetRealm) break;
        }
        
        if (!targetRealm) {
            console.error(`❌ Realm ${realmName} not found in realms data`);
            results.push({
                realm: realmName,
                faction: 'N/A',
                auctionHouseId: 'N/A',
                success: false,
                error: 'Realm not found',
                timestamp: new Date().toISOString()
            });
            continue;
        }
        
        // Process each auction house for the realm
        for (const auctionHouse of targetRealm.auctionHouses) {
            const faction = auctionHouse.type;
            const result = await fetchTSMData(
                auctionHouse.auctionHouseId,
                realmName,
                faction,
                accessToken
            );
            
            if (result) {
                results.push({
                    realm: realmName,
                    faction,
                    auctionHouseId: auctionHouse.auctionHouseId,
                    success: true,
                    timestamp: new Date().toISOString()
                });
            } else {
                results.push({
                    realm: realmName,
                    faction,
                    auctionHouseId: auctionHouse.auctionHouseId,
                    success: false,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Add a small delay to be respectful to the API
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // Save summary
    const summaryPath = path.join(outputDir, `fetch_summary_${realmListName}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({
        realmList: realmListName,
        timestamp: new Date().toISOString(),
        totalRequests: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
    }, null, 2));
    
    console.log('\n=== Fetch Summary ===');
    console.log(`Realm list: ${realmListName}`);
    console.log(`Total requests: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    console.log(`Summary saved to: ${summaryPath}`);
}

// Function to process all realms
async function processAllRealms() {
    console.log('Starting TSM data fetch for ALL realms...\n');
    
    // Get access token
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        console.error('❌ Failed to authenticate with TSM API');
        console.log('Please check your TSM_API_KEY environment variable');
        return;
    }
    
    const results = [];
    
    // Process each region
    for (const region of realmsData.items) {
        console.log(`Processing region: ${region.name} (${region.gameVersion})`);
        
        // Process each realm in the region
        for (const realm of region.realms) {
            console.log(`  Processing realm: ${realm.name}`);
            
            // Process each auction house for the realm
            for (const auctionHouse of realm.auctionHouses) {
                const faction = auctionHouse.type;
                const result = await fetchTSMData(
                    auctionHouse.auctionHouseId,
                    realm.name,
                    faction,
                    accessToken
                );
                
                if (result) {
                    results.push({
                        realm: realm.name,
                        faction,
                        auctionHouseId: auctionHouse.auctionHouseId,
                        success: true,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    results.push({
                        realm: realm.name,
                        faction,
                        auctionHouseId: auctionHouse.auctionHouseId,
                        success: false,
                        timestamp: new Date().toISOString()
                    });
                }
                
                // Add a small delay to be respectful to the API
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    
    // Save summary
    const summaryPath = path.join(outputDir, 'fetch_summary_all.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
        realmList: 'all',
        timestamp: new Date().toISOString(),
        totalRequests: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
    }, null, 2));
    
    console.log('\n=== Fetch Summary ===');
    console.log(`Total requests: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    console.log(`Summary saved to: ${summaryPath}`);
}

// Function to fetch data for a specific realm and faction
async function fetchSpecificRealm(realmName, faction) {
    console.log(`Fetching data for specific realm: ${realmName} (${faction})`);
    
    // Get access token
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        console.error('❌ Failed to authenticate with TSM API');
        console.log('Please check your TSM_API_KEY environment variable');
        return;
    }
    
    // Find the realm
    let targetRealm = null;
    let targetAuctionHouse = null;
    
    for (const region of realmsData.items) {
        for (const realm of region.realms) {
            if (realm.name === realmName) {
                targetRealm = realm;
                targetAuctionHouse = realm.auctionHouses.find(ah => ah.type === faction);
                break;
            }
        }
        if (targetRealm) break;
    }
    
    if (!targetRealm || !targetAuctionHouse) {
        console.error(`Realm ${realmName} with faction ${faction} not found`);
        return;
    }
    
    const result = await fetchTSMData(
        targetAuctionHouse.auctionHouseId,
        realmName,
        faction,
        accessToken
    );
    
    return result;
}

// Function to test API connection
async function testAPIConnection() {
    console.log('Testing TSM API connection...');
    
    try {
        const accessToken = await getAccessToken();
        
        // Test with a known auction house ID (Thunderstrike Alliance: 559)
        const testUrl = `${TSM_BASE_URL}/559`;
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
        
        const response = await fetch(testUrl, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            console.log('✓ API connection successful');
            return true;
        } else {
            console.error(`✗ API connection failed: ${response.status} - ${response.statusText}`);
            return false;
        }
    } catch (error) {
        console.error('✗ API connection failed:', error.message);
        return false;
    }
}

// Function to show help
function showHelp() {
    console.log('TSM Data Fetcher - Usage:');
    console.log('');
    console.log('  node src/scripts/get_TSM_data.mjs [option] [realm] [faction]');
    console.log('');
    console.log('Options:');
    console.log('  anniversary     - Fetch Thunderstrike, Spineshatter, Soulseeker');
    console.log('  all             - Fetch ALL realms (default)');
    console.log('  help            - Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node src/scripts/get_TSM_data.mjs anniversary');
    console.log('  node src/scripts/get_TSM_data.mjs "Thunderstrike" "Alliance"');
    console.log('  node src/scripts/get_TSM_data.mjs all');
    console.log('');
    console.log('Available realm lists:');
    Object.entries(REALM_LISTS).forEach(([name, realms]) => {
        console.log(`  ${name}: ${realms.join(', ')}`);
    });
    console.log('');
    console.log('Authentication:');
    console.log('  Set your TSM API key as an environment variable:');
    console.log('    Windows: set TSM_API_KEY=your_api_key_here');
    console.log('    Linux/Mac: export TSM_API_KEY=your_api_key_here');
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    // Show help if requested
    if (args.length === 0 || args[0] === 'help') {
        showHelp();
        return;
    }
    
    // Test API connection first
    const apiOk = await testAPIConnection();
    if (!apiOk) {
        console.log('\nPlease check your API key and try again.');
        return;
    }
    
    if (args.length === 1) {
        // Single argument - could be a realm list or "all"
        const option = args[0];
        
        if (option === 'all') {
            await processAllRealms();
        } else if (REALM_LISTS[option]) {
            await processRealmList(option);
        } else {
            console.error(`❌ Unknown option: ${option}`);
            showHelp();
        }
    } else if (args.length === 2) {
        // Two arguments - specific realm and faction
        const [realmName, faction] = args;
        await fetchSpecificRealm(realmName, faction);
    } else {
        console.error('❌ Invalid number of arguments');
        showHelp();
    }
}

// Run the script
main().catch(console.error);
