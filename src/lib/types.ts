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
    difficulty: Difficulty;
    materials:  Record<string, number>;
  };
  
/*  unchanged */
export type PriceMap = Record<
  string, // ← instead of number
  {
    minBuyout?: number;
    marketValue?: number;
    vendorPrice?: number;
  }
>;


export type MaterialInfo = {
  name: string;
  quality: number | null;
  class?: string;
  subclass?: string;
  icon?: string;
  slot?: string;
  link?: string;
  vendorPrice?: number; // ✅ Add this line
  createdBy?: {
    spellId: number;
    spellName: string;
    reagents: Record<number, number>;
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