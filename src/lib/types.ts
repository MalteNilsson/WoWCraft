/*  Difficulty stays exactly the same  */
export type Difficulty = {
    orange: number | null;
    yellow: number | null;
    green:  number | null;
    gray:   number | null;
  };
  
  /*  NEW – describes the JSON before cleanup.
      Some quantities may be undefined. */
export type RawRecipe = {
    id: number;
    name: string;
    minSkill: number;
    quality: number;
    url: string;
    icon: string;
    difficulty: Difficulty;
    materials: Record<string, number | undefined>;
    produces: {
        id: number;
        name: string;
        quantity: number;
    };
};
  
/*  Your existing clean shape – AFTER you drop undefineds. */
export type Recipe = {
    id:         number;
    name:       string;
    quality:    number;                // ← new
    minSkill:   number;
    difficulty: {
        orange?: number;
        yellow?: number;
        green?: number;
        gray?: number;
    };
    materials:  Record<string, number>;
    icon:       string;
    url?:       string;  // WoWhead link (version-specific: classic or tbc)
    produces?: {
        id: number;
        name: string;
        quantity: number;
    };
    source?: {
        type: 'trainer' | 'item' | 'free';
        // For trainer recipes
        cost?: number;
        trainers?: Array<{
            id: number;
            name: string;
        }>;
        // For item recipes
        recipeItemId?: number;
        recipeItemName?: string;
    };
};
  
/*  unchanged */
export type PriceMap = Record<
  number,
  {
    minBuyout?: number;
    marketValue?: number;
    vendorPrice?: number;
  }
>;


export type MaterialInfo = {
  name?: string;
  icon?: string;
  quality?: number;
  class?: string;
  subclass?: string;
  slot?: string;
  link?: string;
  vendorPrice?: number;
  buyPrice?: number;
  auctionhouse?: boolean;
  bop?: boolean;
  limitedStock?: boolean;
  createdBy?: {
    spellId?: number;
    spellName?: string;
    reagents: Record<string, number>;
    minCount?: number;
    maxCount?: number;
  };
};

export type MaterialTreeNode = {
  id: number;
  name: string;
  quantity: number;
  totalCost: number;
  buyCost: number;
  craftCost: number;
  children: MaterialTreeNode[];
  noAhPrice?: boolean;
};