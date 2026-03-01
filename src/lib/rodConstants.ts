/** Spell IDs for enchanting rod recipes (each rod uses the previous as material) */
export const ENCHANTING_ROD_SPELL_IDS = new Set<number>([
    7421,   // Runed Copper Rod
    7795,   // Runed Silver Rod
    13628,  // Runed Golden Rod
    13702,  // Runed Truesilver Rod
    20051,  // Runed Arcanite Rod
    32664,  // Runed Fel Iron Rod
    32665,  // Runed Adamantite Rod
    32667,  // Runed Eternium Rod
]);

/** Items produced by rod recipes - excluded from rod material cost (made in previous rod step) */
export const ENCHANTING_ROD_PRODUCT_ITEM_IDS = new Set<number>([
    6218,   // Runed Copper Rod
    6339,   // Runed Silver Rod
    11130,  // Runed Golden Rod
    11145,  // Runed Truesilver Rod
    16207,  // Runed Arcanite Rod
    22461,  // Runed Fel Iron Rod
    22462,  // Runed Adamantite Rod
    22463,  // Runed Eternium Rod
]);

/** Spell IDs for engineering tool recipes (required tools, inserted at skill level) */
export const ENGINEERING_TOOL_SPELL_IDS = new Set<number>([
    7430,   // Arclight Spanner (skill 50)
    12590,  // Gyromatic Micro-Adjustor (skill 175)
]);

/** Items produced by engineering tool recipes - not used as materials for other tools (empty set, but kept for API consistency) */
export const ENGINEERING_TOOL_PRODUCT_ITEM_IDS = new Set<number>([
    6219,   // Arclight Spanner
    10498,  // Gyromatic Micro-Adjustor
]);
