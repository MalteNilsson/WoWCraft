import * as fengariNamespace from 'fengari-web';
import { auctionatorListName, shoppingListTitle, shoppingQuantity, type GuideStep, type ShoppingListItem } from '../shoppingList';
import { libDeflateSource } from './vendor/LibDeflate.source';
import { libSerializeSource } from './vendor/LibSerialize.source';

type FengariApi = {
  lua: {
    LUA_OK: number;
    lua_getglobal(state: unknown, name: Uint8Array): number;
    lua_tolstring(state: unknown, index: number): Uint8Array;
  };
  lauxlib: {
    luaL_newstate(): unknown;
    luaL_dostring(state: unknown, code: Uint8Array): number;
  };
  lualib: {
    luaL_openlibs(state: unknown): void;
  };
  to_luastring(value: string): Uint8Array;
  to_jsstring(value: Uint8Array): string;
};

/**
 * The published fengari-web bundle marks itself as an ES module without a default
 * export. Webpack then resolves `import fengari from 'fengari-web'` to undefined.
 * Turbopack still exposes the API as the default. Accept either shape.
 */
function fengariApi(namespace: object): FengariApi {
  const record = namespace as FengariApi & { default?: FengariApi };
  if (typeof record.lauxlib?.luaL_newstate === 'function') return record;
  if (record.default && typeof record.default.lauxlib?.luaL_newstate === 'function') return record.default;
  throw new Error('Fengari failed to load');
}

const { lauxlib, lua, lualib, to_jsstring, to_luastring } = fengariApi(fengariNamespace);

/** Current WeakAuras data revision. Import modernizes anything older than the installed addon. */
const INTERNAL_VERSION = 89;
/** Display transmission version for an aura with no child group. */
const TRANSMIT_VERSION = 1421;
const WEAKAURA_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()';

/** Stable 11-character id so importing the same list again updates that aura. */
export function weakAuraUid(name: string): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let out = '';
  for (let i = 0; i < 11; i++) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    out += WEAKAURA_ALPHABET[hash % 64];
  }
  return out;
}

function luaString(value: string): string {
  return '"' + value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r') + '"';
}

function plainText(value: string): string {
  return value.replace(/[|%\r\n\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

type ShoppingRow = { id: number; name: string; need: number; source: 'vendor' | 'auction' | ''; icon: string; quality: number; copper: number };

function shoppingRows(items: ShoppingListItem[]): ShoppingRow[] {
  const byId = new Map<number, ShoppingRow>();
  for (const item of items) {
    const name = plainText(item.name || '');
    if (!name || !Number.isFinite(item.itemId) || item.itemId <= 0) continue;
    const need = shoppingQuantity(item.quantity);
    const source = item.source === 'vendor' || item.source === 'auction' ? item.source : '';
    const icon = iconName(item.icon);
    const quality = Number.isFinite(item.quality) ? Math.max(0, Math.min(7, Math.round(item.quality!))) : 1;
    const copper = Number.isFinite(item.copper) ? Math.max(0, Math.round(item.copper!)) : 0;
    const existing = byId.get(item.itemId);
    if (existing) existing.need += need;
    else byId.set(item.itemId, { id: item.itemId, name, need, source, icon, quality, copper });
  }
  return [...byId.values()];
}

/**
 * Second frame. Opens beside the professions window and lists the guide.
 * Lua 5.1: no continue, and frame scripts must not touch aura_env.
 */
function iconName(icon: string | undefined): string {
  return (icon || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function guideSource(profession: string, steps: GuideStep[]): string {
  const stepLines = steps.flatMap((step) => {
    const name = plainText(step.name);
    if (!name) return [];
    const crafts = Number.isFinite(step.crafts) ? Math.max(0, Math.round(step.crafts)) : 0;
    const from = Math.round(step.from);
    const to = Math.round(step.to);
    const yellow = Number.isFinite(step.yellow) ? Math.round(step.yellow) : 0;
    const gray = Number.isFinite(step.gray) ? Math.round(step.gray) : to;
    const green = Number.isFinite(step.green) ? Math.round(step.green!) : 0;
    const quality = Number.isFinite(step.quality) ? Math.max(0, Math.min(7, Math.round(step.quality!))) : 1;
    const spell = Number.isFinite(step.spell) ? Math.round(step.spell!) : 0;
    const source = step.source === 'trainer' || step.source === 'item' || step.source === 'free' ? step.source : '';
    const sourceName = plainText(step.sourceName || '');
    const sourceIcon = iconName(step.sourceIcon);
    const sourceQuality = Number.isFinite(step.sourceQuality) ? Math.max(0, Math.min(7, Math.round(step.sourceQuality!))) : 1;
    const eachCost = Number.isFinite(step.eachCost) ? Math.max(0, Math.round(step.eachCost!)) : 0;
    const eachSpend = Number.isFinite(step.eachSpend) ? Math.max(0, Math.round(step.eachSpend!)) : eachCost;
    const recipeCost = Number.isFinite(step.recipeCost) ? Math.max(0, Math.round(step.recipeCost!)) : 0;
    const bop = step.bop ? 'true' : 'false';
    const luaNumber = (value: number) => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
    const luaReturns = (info: GuideStep['returns']) => {
      if (!info || (info.kind !== 'vendor' && info.kind !== 'auction' && info.kind !== 'disenchant')) return '';
      const copper = Number.isFinite(info.copper) ? Math.max(0, Math.round(info.copper)) : 0;
      const items = (info.items ?? [])
        .filter((item) => Number.isFinite(item.id) && item.id > 0 && Number.isFinite(item.each) && item.each > 0)
        .map((item) => {
          const itemQuality = Number.isFinite(item.quality) ? Math.max(0, Math.min(7, Math.round(item.quality!))) : 1;
          const itemCopper = Number.isFinite(item.copper) ? Math.max(0, Math.round(item.copper)) : 0;
          return `{ id = ${Math.round(item.id)}, name = ${luaString(plainText(item.name) || `Item ${item.id}`)}, icon = ${luaString(iconName(item.icon))}, quality = ${itemQuality}, each = ${luaNumber(item.each)}, copper = ${itemCopper} }`;
        })
        .join(', ');
      return `returns = { kind = ${luaString(info.kind)}, copper = ${copper}, items = { ${items} } }, `;
    };
    const luaMats = (materials: GuideStep['materials']) => materials
      .filter((material) => Number.isFinite(material.id) && material.id > 0 && Number.isFinite(material.each) && material.each > 0)
      .map((material) => `{ id = ${Math.round(material.id)}, name = ${luaString(plainText(material.name) || `Item ${material.id}`)}, icon = ${luaString(iconName(material.icon))}, each = ${Math.round(material.each)} }`)
      .join(', ');
    const luaAlt = (alt: NonNullable<GuideStep['alts']>[number]) => {
      const altName = plainText(alt.name);
      if (!altName) return '';
      const altQuality = Number.isFinite(alt.quality) ? Math.max(0, Math.min(7, Math.round(alt.quality!))) : 1;
      const altSpell = Number.isFinite(alt.spell) ? Math.round(alt.spell!) : 0;
      const altCrafts = Number.isFinite(alt.crafts) ? Math.max(0, Math.round(alt.crafts)) : 0;
      const altYellow = Number.isFinite(alt.yellow) ? Math.round(alt.yellow) : 0;
      const altGreen = Number.isFinite(alt.green) ? Math.round(alt.green!) : 0;
      const altGray = Number.isFinite(alt.gray) ? Math.round(alt.gray) : to;
      const altEach = Number.isFinite(alt.eachCost) ? Math.max(0, Math.round(alt.eachCost)) : 0;
      const altSpend = Number.isFinite(alt.eachSpend) ? Math.max(0, Math.round(alt.eachSpend)) : altEach;
      const altRecipe = Number.isFinite(alt.recipeCost) ? Math.max(0, Math.round(alt.recipeCost)) : 0;
      const altSource = alt.source === 'trainer' || alt.source === 'item' || alt.source === 'free' ? alt.source : '';
      const altSourceQuality = Number.isFinite(alt.sourceQuality) ? Math.max(0, Math.min(7, Math.round(alt.sourceQuality!))) : 1;
      return `{ name = ${luaString(altName)}, icon = ${luaString(iconName(alt.icon))}, quality = ${altQuality}, spell = ${altSpell}, crafts = ${altCrafts}, yellow = ${altYellow}, green = ${altGreen}, gray = ${altGray}, eachCost = ${altEach}, eachSpend = ${altSpend}, recipeCost = ${altRecipe}, bop = ${alt.bop ? 'true' : 'false'}, source = ${luaString(altSource)}, sourceName = ${luaString(plainText(alt.sourceName || ''))}, sourceIcon = ${luaString(iconName(alt.sourceIcon))}, sourceQuality = ${altSourceQuality}, ${luaReturns(alt.returns)} mats = { ${luaMats(alt.materials)} } }`;
    };
    const recipeItem = step.recipeItem && step.recipeItem.id > 0 && step.recipeItem.quantity > 0
      ? `recipeItem = { id = ${Math.round(step.recipeItem.id)}, name = ${luaString(plainText(step.recipeItem.name) || `Item ${step.recipeItem.id}`)}, icon = ${luaString(iconName(step.recipeItem.icon))}, quantity = ${Math.max(1, Math.round(step.recipeItem.quantity))} }, `
      : '';
    const alts = (step.alts ?? []).map(luaAlt).filter(Boolean).join(', ');
    return `    { name = ${luaString(name)}, icon = ${luaString(iconName(step.icon))}, crafts = ${crafts}, fromSkill = ${from}, toSkill = ${to}, yellow = ${yellow}, green = ${green}, gray = ${gray}, quality = ${quality}, spell = ${spell}, source = ${luaString(source)}, sourceName = ${luaString(sourceName)}, sourceIcon = ${luaString(sourceIcon)}, sourceQuality = ${sourceQuality}, eachCost = ${eachCost}, eachSpend = ${eachSpend}, recipeCost = ${recipeCost}, bop = ${bop}, ${recipeItem}${luaReturns(step.returns)} alts = { ${alts} }, mats = { ${luaMats(step.materials)} } },`;
  });
  return `
  local guideSteps = {
${stepLines.join('\n')}
  }
  local guideProfession = ${luaString(plainText(profession) || 'Profession')}
  local guideMinimum = guideSteps[1] and guideSteps[1].fromSkill or 0
  local guideStamp = ${luaString(String(Date.now()))}
  local function refreshGuide()
    local function professionHost()
      local frame = ProfessionsFrame
      if type(frame) == "table" and type(frame.IsShown) == "function" and frame:IsShown() then
        return frame
      end
      frame = TradeSkillFrame
      if type(frame) == "table" and type(frame.IsShown) == "function" and frame:IsShown() then
        return frame
      end
    end
    local function savedChoice()
      WoWCraftShoppingHooks.choices = WoWCraftShoppingHooks.choices or {}
      local function knownChoice(value)
        return value == "skip" or value == "full" or value == "ack"
      end
      local session = WoWCraftShoppingHooks.choices[aura_env.id]
      if type(session) == "table" and session.stamp == guideStamp and knownChoice(session.choice) then
        if type(aura_env.saved) == "table" then
          aura_env.saved.guideChoice = session.choice
          aura_env.saved.guideChoiceStamp = guideStamp
        end
        return session.choice
      end
      if type(aura_env.saved) ~= "table" then return nil end
      if aura_env.saved.guideChoiceStamp ~= guideStamp then return nil end
      if knownChoice(aura_env.saved.guideChoice) then
        WoWCraftShoppingHooks.choices[aura_env.id] = { stamp = guideStamp, choice = aura_env.saved.guideChoice }
        return aura_env.saved.guideChoice
      end
    end
    local choice = savedChoice()
    local remembered = slot.knownSkill
    if type(remembered) ~= "number" and type(aura_env.saved) == "table" and type(aura_env.saved.guideKnownSkill) == "number" then
      remembered = aura_env.saved.guideKnownSkill
    end
    local guideSkill
    local function craftsBetween(low, high, yellow, gray, fallback)
      if high <= low then return 0 end
      local Y = yellow or 0
      local G = gray or high
      local sum = 0
      for lvl = low, high - 1 do
        local p
        if lvl < Y then
          p = 1
        elseif lvl >= G or G == Y then
          p = 0
        else
          p = (G - lvl) / (G - Y)
        end
        if p <= 0 then
          if fallback and fallback > 0 then return fallback end
          return high - low
        end
        sum = sum + (1 / p)
      end
      return math.ceil(sum)
    end
    local function stepCount(step)
      if type(guideSkill) ~= "number" then return step.crafts end
      if guideSkill >= step.toSkill then return 0 end
      local low = guideSkill
      if low < step.fromSkill then low = step.fromSkill end
      return craftsBetween(low, step.toSkill, step.yellow, step.gray, step.crafts)
    end
    local function applyShopping()
      if choice ~= "skip" or type(guideSkill) ~= "number" then
        if choice ~= "skip" then slot.adjustShopping = false end
        return
      end
      local adjusted = {}
      for index = 1, #guideSteps do
        local step = guideSteps[index]
        local crafts = stepCount(step)
        if crafts > 0 and type(step.mats) == "table" then
          for matIndex = 1, #step.mats do
            local mat = step.mats[matIndex]
            adjusted[mat.id] = (adjusted[mat.id] or 0) + mat.each * crafts
          end
        end
        local recipeItem = step.recipeItem
        if crafts > 0 and type(recipeItem) == "table" and recipeItem.id then
          adjusted[recipeItem.id] = (adjusted[recipeItem.id] or 0) + (tonumber(recipeItem.quantity) or 1)
        end
      end
      slot.adjustedNeed = adjusted
      slot.adjustShopping = true
    end
    local function retireFrame(frame)
      if not frame or frame.wowcraftKept then return end
      frame.wowcraftRetired = true
      frame:Hide()
      if frame.skipWarn then frame.skipWarn:Hide() end
      if not frame.wowcraftRetireHook then
        frame.wowcraftRetireHook = true
        frame:SetScript("OnShow", function(self)
          if self.wowcraftRetired then self:Hide() end
        end)
      end
    end
    local function sweepExtras(kind, kept)
      if type(WoWCraftShoppingHooks.auras) ~= "table" then return end
      for _, other in pairs(WoWCraftShoppingHooks.auras) do
        if type(other) == "table" and other ~= slot then
          local extra = kind == "guide" and other.guide or other.guidePrompt
          if extra and extra ~= kept then
            extra.wowcraftKept = nil
            retireFrame(extra)
          end
        end
      end
    end
    local function hidePrompt()
      if slot.guidePrompt then slot.guidePrompt:Hide() end
    end
    local function showPrompt(level, mode)
      WoWCraftShoppingHooks.prompts = WoWCraftShoppingHooks.prompts or {}
      local prompt = WoWCraftShoppingHooks.prompts[aura_env.id]
      if prompt and (prompt.wowcraftRetired or not prompt.ok) then
        if type(prompt.Hide) == "function" then prompt:Hide() end
        prompt = nil
      end
      if not prompt then
        prompt = CreateFrame("Frame", nil, UIParent)
        prompt:SetSize(460, 176)
        prompt:EnableMouse(true)
        prompt:SetClampedToScreen(true)
        prompt.bg = prompt:CreateTexture(nil, "BACKGROUND")
        prompt.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
        prompt.bg:SetAllPoints()
        prompt.bg:SetVertexColor(0.09, 0.09, 0.09, 0.96)
        prompt.edges = {}
        for edgeIndex = 1, 4 do
          local edge = prompt:CreateTexture(nil, "BORDER")
          edge:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
          edge:SetVertexColor(0.89, 0.55, 0.16, 1)
          prompt.edges[edgeIndex] = edge
        end
        local edgeTop, edgeRight, edgeBottom, edgeLeft = prompt.edges[1], prompt.edges[2], prompt.edges[3], prompt.edges[4]
        edgeTop:SetPoint("TOPLEFT")
        edgeTop:SetPoint("TOPRIGHT")
        edgeTop:SetHeight(1)
        edgeBottom:SetPoint("BOTTOMLEFT")
        edgeBottom:SetPoint("BOTTOMRIGHT")
        edgeBottom:SetHeight(1)
        edgeLeft:SetPoint("TOPLEFT")
        edgeLeft:SetPoint("BOTTOMLEFT")
        edgeLeft:SetWidth(1)
        edgeRight:SetPoint("TOPRIGHT")
        edgeRight:SetPoint("BOTTOMRIGHT")
        edgeRight:SetWidth(1)
        local function applyFont(text, size)
          text:SetFontObject(GameFontHighlight)
          local font, _, flags = text:GetFont()
          if font then text:SetFont(font, size, flags or "OUTLINE") end
        end
        local function makeText(parent, size, justify)
          local text = parent:CreateFontString(nil, "OVERLAY")
          applyFont(text, size)
          text:SetShadowColor(0, 0, 0, 0.85)
          text:SetShadowOffset(1, -1)
          text:SetJustifyH(justify)
          text:SetJustifyV("MIDDLE")
          text:SetWordWrap(false)
          return text
        end
        prompt.title = makeText(prompt, 15, "LEFT")
        prompt.title:SetPoint("TOPLEFT", prompt, "TOPLEFT", 16, -14)
        prompt.title:SetSize(428, 20)
        prompt.title:SetText("This guide skipped ahead")
        prompt.title:SetTextColor(1, 0.78, 0.45)
        prompt.body = makeText(prompt, 13, "LEFT")
        prompt.body:SetPoint("TOPLEFT", prompt, "TOPLEFT", 16, -40)
        prompt.body:SetWidth(428)
        prompt.body:SetHeight(84)
        prompt.body:SetWordWrap(true)
        prompt.body:SetJustifyV("TOP")
        prompt.body:SetTextColor(0.92, 0.92, 0.92)
        local function makeButton(label, width, r, g, b)
          local button = CreateFrame("Button", nil, prompt)
          button:SetSize(width, 26)
          button:RegisterForClicks("LeftButtonUp")
          button:EnableMouse(true)
          button.bg = button:CreateTexture(nil, "BACKGROUND")
          button.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
          button.bg:SetAllPoints()
          button.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
          button.label = makeText(button, 13, "CENTER")
          button.label:SetAllPoints()
          button.label:SetText(label)
          button.label:SetTextColor(r, g, b)
          button:SetScript("OnEnter", function(self)
            self.bg:SetVertexColor(0.26, 0.26, 0.26, 1)
          end)
          button:SetScript("OnLeave", function(self)
            self.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
          end)
          return button
        end
        prompt.keep = makeButton("Keep full guide", 168, 0.9, 0.9, 0.9)
        prompt.accept = makeButton("Accept skip", 140, 0.890, 0.690, 0.337)
        prompt.keep:SetPoint("BOTTOMLEFT", prompt, "BOTTOMLEFT", 16, 16)
        prompt.accept:SetPoint("BOTTOMRIGHT", prompt, "BOTTOMRIGHT", -16, 16)
        prompt.keep:SetScript("OnClick", function()
          local owner = prompt.choiceSlot
          if type(owner) == "table" then
            owner.guideChoice = "full"
            if type(owner.saved) == "table" then
              owner.saved.guideChoice = "full"
              owner.saved.guideChoiceStamp = prompt.choiceStamp
            end
          end
          WoWCraftShoppingHooks.choices = WoWCraftShoppingHooks.choices or {}
          if prompt.choiceAuraId then
            WoWCraftShoppingHooks.choices[prompt.choiceAuraId] = { stamp = prompt.choiceStamp, choice = "full" }
          end
          prompt:Hide()
        end)
        prompt.accept:SetScript("OnClick", function()
          local owner = prompt.choiceSlot
          if type(owner) == "table" then
            owner.guideChoice = "skip"
            if type(owner.saved) == "table" then
              owner.saved.guideChoice = "skip"
              owner.saved.guideChoiceStamp = prompt.choiceStamp
            end
          end
          WoWCraftShoppingHooks.choices = WoWCraftShoppingHooks.choices or {}
          if prompt.choiceAuraId then
            WoWCraftShoppingHooks.choices[prompt.choiceAuraId] = { stamp = prompt.choiceStamp, choice = "skip" }
          end
          prompt:Hide()
        end)
        prompt.ok = makeButton("OK", 96, 0.890, 0.690, 0.337)
        prompt.ok:SetPoint("BOTTOMRIGHT", prompt, "BOTTOMRIGHT", -16, 16)
        prompt.ok:SetScript("OnClick", function()
          local owner = prompt.choiceSlot
          if type(owner) == "table" then
            owner.guideChoice = "ack"
            if type(owner.saved) == "table" then
              owner.saved.guideChoice = "ack"
              owner.saved.guideChoiceStamp = prompt.choiceStamp
            end
          end
          WoWCraftShoppingHooks.choices = WoWCraftShoppingHooks.choices or {}
          if prompt.choiceAuraId then
            WoWCraftShoppingHooks.choices[prompt.choiceAuraId] = { stamp = prompt.choiceStamp, choice = "ack" }
          end
          prompt:Hide()
        end)
        slot.guidePrompt = prompt
        WoWCraftShoppingHooks.prompts[aura_env.id] = prompt
      end
      slot.guidePrompt = prompt
      prompt.wowcraftRetired = false
      prompt.wowcraftKept = true
      prompt.choiceSlot = slot
      prompt.choiceAuraId = aura_env.id
      prompt.choiceProfession = guideProfession
      prompt.choiceStamp = guideStamp
      local stale = WoWCraftShoppingHooks.prompts[guideProfession]
      if type(stale) == "table" and stale ~= prompt and type(stale.Hide) == "function" then
        stale:Hide()
      end
      if mode == "high" then
        prompt.title:SetText("This guide is too high")
        prompt.body:SetText("Your " .. guideProfession .. " is " .. level .. ". This guide starts at " .. guideMinimum .. ", so these crafts are above your current skill.")
        prompt.keep:Hide()
        prompt.accept:Hide()
        prompt.ok:Show()
      else
        prompt.title:SetText("This guide skipped ahead")
        prompt.body:SetText("Your " .. guideProfession .. " is " .. level .. ". This guide starts at " .. guideMinimum .. ", so steps before " .. level .. " are skipped. Accept skip to drop those steps and take their materials off the shopping list. Keep the full guide to show every step.")
        prompt.keep:Show()
        prompt.accept:Show()
        prompt.ok:Hide()
      end
      prompt:SetFrameStrata("TOOLTIP")
      prompt:SetFrameLevel(1000)
      prompt:ClearAllPoints()
      prompt:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
      if type(prompt.Raise) == "function" then prompt:Raise() end
      prompt:Show()
    end
    local function syncPrompt(level)
      if choice ~= nil then
        hidePrompt()
        return
      end
      if type(level) ~= "number" then return end
      if level <= 0 then
        hidePrompt()
        return
      end
      if level > guideMinimum then
        showPrompt(level, "skip")
      elseif level < guideMinimum then
        showPrompt(level, "high")
      else
        hidePrompt()
      end
    end
    local host = professionHost()
    if not host or #guideSteps == 0 then
      slot.guideHostOpen = false
      if slot.guide then slot.guide:Hide() end
      if #guideSteps == 0 then
        hidePrompt()
        return
      end
      guideSkill = remembered
      applyShopping()
      syncPrompt(remembered)
      return
    end
    local skill, profName
    local wanted = guideProfession:lower()
    local function nameMatches(name)
      if wanted == "" then return true end
      if type(name) ~= "string" or name == "" then return false end
      return name:lower():find(wanted, 1, true) and true or false
    end
    local skillNamed = false
    local function take(rank, name)
      local named = type(name) == "string" and name ~= ""
      local matches = named and nameMatches(name)
      if named and not matches then
        if not skillNamed then profName = name end
        return
      end
      if matches then profName = name end
      rank = tonumber(rank)
      if not rank then return end
      if matches then
        skill = math.floor(rank + 0.5)
        skillNamed = true
      elseif not skillNamed and (type(skill) ~= "number" or skill <= 0) then
        skill = math.floor(rank + 0.5)
      end
    end
    local function takeInfo(info)
      if type(info) ~= "table" then return end
      take(info.skillLevel, info.professionName or info.parentProfessionName or info.name)
    end
    if type(host.professionInfo) == "table" then
      takeInfo(host.professionInfo)
    end
    if type(host.GetProfessionInfo) == "function" then
      takeInfo(host:GetProfessionInfo())
    end
    local tradeReady = false
    if C_TradeSkillUI and type(C_TradeSkillUI.IsTradeSkillReady) == "function" and C_TradeSkillUI.IsTradeSkillReady() then
      tradeReady = true
    end
    if C_TradeSkillUI and type(C_TradeSkillUI.GetBaseProfessionInfo) == "function" and (tradeReady or type(C_TradeSkillUI.IsTradeSkillReady) ~= "function") then
      local info = C_TradeSkillUI.GetBaseProfessionInfo()
      if type(info) == "table" then
        takeInfo(info)
      elseif type(info) == "number" then
        take(info, nil)
      end
    end
    if host == TradeSkillFrame and type(GetTradeSkillLine) == "function" then
      local lineName, rank = GetTradeSkillLine()
      take(rank, lineName)
    elseif type(GetTradeSkillLine) == "function" and type(skill) ~= "number" then
      local lineName, rank = GetTradeSkillLine()
      take(rank, lineName)
    end
    if type(profName) == "string" and profName ~= "" and not nameMatches(profName) then
      if slot.guide then slot.guide:Hide() end
      return
    end
    if type(GetProfessions) == "function" and type(GetProfessionInfo) == "function" then
      local function consider(profIndex)
        if type(profIndex) ~= "number" then return end
        local name, _, rank = GetProfessionInfo(profIndex)
        if nameMatches(name) then
          take(rank, name)
        end
      end
      local first, second, archaeology, fishing, cooking = GetProfessions()
      consider(first)
      consider(second)
      consider(archaeology)
      consider(fishing)
      consider(cooking)
    end
    if type(skill) ~= "number" or skill <= 0 then
      local page = host.CraftingPage
      local bar = page and (page.RankBar or page.ProfessionsRankBar) or host.RankBar
      if type(bar) == "table" and type(bar.GetValue) == "function" then
        take(bar:GetValue(), profName)
      end
    end
    if type(skill) == "number" and skill > 0 then
      slot.knownSkill = skill
      if type(slot.saved) == "table" then
        slot.saved.guideKnownSkill = skill
      end
    end
    guideSkill = skill
    if choice == "full" then guideSkill = nil end
    applyShopping()
    local nextIndex
    for index = 1, #guideSteps do
      if type(guideSkill) ~= "number" or guideSkill < guideSteps[index].toSkill then
        nextIndex = index
        break
      end
    end
    local function rowMake(step, index)
      if nextIndex == index then return tostring(stepCount(step)) end
      if type(guideSkill) == "number" and guideSkill >= step.toSkill then return "Done" end
      return tostring(step.crafts)
    end
    WoWCraftShoppingHooks.guides = WoWCraftShoppingHooks.guides or {}
    local sharedGuide = WoWCraftShoppingHooks.guides[guideProfession]
    if sharedGuide and sharedGuide.wowcraftRetired then
      sharedGuide = nil
      WoWCraftShoppingHooks.guides[guideProfession] = nil
    end
    if sharedGuide and sharedGuide.layoutRevision == 4 then
      if slot.guide and slot.guide ~= sharedGuide then
        slot.guide.wowcraftKept = nil
        retireFrame(slot.guide)
      end
      slot.guide = sharedGuide
    end
    if slot.guide and slot.guide.layoutRevision ~= 4 then
      if slot.guide.skipWarn then slot.guide.skipWarn:Hide() end
      slot.guide.wowcraftKept = nil
      retireFrame(slot.guide)
      if WoWCraftShoppingHooks.guides[guideProfession] == slot.guide then
        WoWCraftShoppingHooks.guides[guideProfession] = nil
      end
      slot.guide = nil
    end
    local guide = slot.guide
    if not guide then
      guide = CreateFrame("Frame", nil, UIParent)
      guide.layoutRevision = 4
      guide:SetFrameStrata("HIGH")
      guide.bg = guide:CreateTexture(nil, "BACKGROUND")
      guide.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      guide.bg:SetPoint("TOPLEFT", 1, -1)
      guide.bg:SetPoint("BOTTOMRIGHT", -1, 1)
      guide.bg:SetVertexColor(0.090, 0.090, 0.090, 0.78)
      guide.edges = {}
      for edgeIndex = 1, 4 do
        local edge = guide:CreateTexture(nil, "BORDER")
        edge:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
        edge:SetVertexColor(0.251, 0.251, 0.251, 1)
        guide.edges[edgeIndex] = edge
      end
      local edgeTop, edgeRight, edgeBottom, edgeLeft = guide.edges[1], guide.edges[2], guide.edges[3], guide.edges[4]
      edgeTop:SetPoint("TOPLEFT")
      edgeTop:SetPoint("TOPRIGHT")
      edgeTop:SetHeight(1)
      edgeBottom:SetPoint("BOTTOMLEFT")
      edgeBottom:SetPoint("BOTTOMRIGHT")
      edgeBottom:SetHeight(1)
      edgeLeft:SetPoint("TOPLEFT")
      edgeLeft:SetPoint("BOTTOMLEFT")
      edgeLeft:SetWidth(1)
      edgeRight:SetPoint("TOPRIGHT")
      edgeRight:SetPoint("BOTTOMRIGHT")
      edgeRight:SetWidth(1)
      local function applyFont(text, size)
        text:SetFontObject(GameFontHighlight)
        local font, _, flags = text:GetFont()
        if font then text:SetFont(font, size, flags or "OUTLINE") end
      end
      local function makeText(parent, size, justify)
        local text = parent:CreateFontString(nil, "OVERLAY")
        applyFont(text, size)
        text:SetShadowColor(0, 0, 0, 0.85)
        text:SetShadowOffset(1, -1)
        text:SetJustifyH(justify)
        text:SetJustifyV("MIDDLE")
        text:SetWordWrap(false)
        return text
      end
      guide.applyFont = applyFont
      guide.makeText = makeText
      guide.title = makeText(guide, 14, "LEFT")
      guide.headerName = makeText(guide, 12, "LEFT")
      guide.headerSkill = makeText(guide, 12, "RIGHT")
      guide.headerMake = makeText(guide, 12, "RIGHT")
      guide.currentBg = guide:CreateTexture(nil, "BACKGROUND")
      guide.currentBg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      guide.currentBg:SetVertexColor(0.890, 0.690, 0.337, 0.12)
      guide.nowIcon = guide:CreateTexture(nil, "ARTWORK")
      guide.nowIcon:SetSize(32, 32)
      guide.nowTag = makeText(guide, 12, "LEFT")
      guide.nowName = makeText(guide, 15, "LEFT")
      guide.nowSkill = makeText(guide, 12, "LEFT")
      guide.nowCount = makeText(guide, 16, "RIGHT")
      guide.divider = guide:CreateTexture(nil, "BORDER")
      guide.divider:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      guide.divider:SetVertexColor(0.251, 0.251, 0.251, 1)
      guide.divider:SetHeight(1)
      guide.nowMats = {}
      guide.measure = makeText(guide, 13, "LEFT")
      guide.measure:SetAlpha(0)
      local scroll = CreateFrame("ScrollFrame", nil, guide)
      scroll:EnableMouse(true)
      scroll:EnableMouseWheel(true)
      scroll:SetScript("OnMouseWheel", function(self, delta)
        local current = self:GetVerticalScroll() or 0
        local range = self:GetVerticalScrollRange() or 0
        local nextScroll = current - (delta * 48)
        if nextScroll < 0 then nextScroll = 0 end
        if nextScroll > range then nextScroll = range end
        self:SetVerticalScroll(nextScroll)
      end)
      local content = CreateFrame("Frame", nil, scroll)
      content:SetSize(1, 1)
      scroll:SetScrollChild(content)
      if type(content.SetClipsChildren) == "function" then
        content:SetClipsChildren(true)
      end
      guide.scroll = scroll
      guide.content = content
      guide.lines = {}
      local toggle = CreateFrame("Button", nil, guide)
      toggle:SetSize(22, 22)
      toggle:RegisterForClicks("LeftButtonUp")
      toggle.label = toggle:CreateFontString(nil, "OVERLAY")
      applyFont(toggle.label, 20)
      toggle.label:SetAllPoints()
      toggle.label:SetJustifyH("CENTER")
      toggle.label:SetJustifyV("MIDDLE")
      toggle.label:SetTextColor(0.890, 0.690, 0.337)
      toggle.label:SetShadowColor(0, 0, 0, 0.85)
      toggle.label:SetShadowOffset(1, -1)
      toggle:SetScript("OnClick", function()
        slot.guideMinimized = not slot.guideMinimized
        if type(slot.saved) == "table" then
          slot.saved.guideMinimized = slot.guideMinimized and true or false
        end
      end)
      toggle:SetScript("OnEnter", function(self)
        self.label:SetTextColor(1, 0.860, 0.550)
      end)
      toggle:SetScript("OnLeave", function(self)
        self.label:SetTextColor(0.890, 0.690, 0.337)
      end)
      guide.toggle = toggle
      local function tradeIndex(spellId, name)
        if type(GetNumTradeSkills) ~= "function" or type(GetTradeSkillInfo) ~= "function" then return end
        local num = GetNumTradeSkills() or 0
        for i = 1, num do
          local skillName, skillType = GetTradeSkillInfo(i)
          if skillType ~= "header" and skillType ~= "subheader" then
            local id
            if type(GetTradeSkillRecipeLink) == "function" then
              local link = GetTradeSkillRecipeLink(i)
              if type(link) == "string" then
                id = tonumber(link:match("enchant:(%d+)")) or tonumber(link:match("spell:(%d+)"))
              end
            end
            if id == spellId or (not id and skillName == name) then
              return i
            end
          end
        end
      end
      local function castCraft(spellId, name, count)
        spellId = tonumber(spellId)
        count = tonumber(count) or 1
        if not spellId or count < 1 then return end
        if C_TradeSkillUI and type(C_TradeSkillUI.OpenRecipe) == "function" then
          C_TradeSkillUI.OpenRecipe(spellId)
        end
        local index = tradeIndex(spellId, name)
        if index and type(SelectTradeSkill) == "function" then
          SelectTradeSkill(index)
        end
        if C_TradeSkillUI and type(C_TradeSkillUI.CraftRecipe) == "function" then
          C_TradeSkillUI.CraftRecipe(spellId, count)
          return
        end
        if index and type(DoTradeSkill) == "function" then
          DoTradeSkill(index, count)
        end
      end
      guide.tradeIndex = tradeIndex
      guide.castCraft = castCraft
      local function makeCraftButton(label, buttonWidth)
        local button = CreateFrame("Button", nil, guide)
        button:SetSize(buttonWidth, 22)
        button:RegisterForClicks("LeftButtonUp")
        button:EnableMouse(true)
        button.bg = button:CreateTexture(nil, "BACKGROUND")
        button.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
        button.bg:SetAllPoints()
        button.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
        button.label = button:CreateFontString(nil, "OVERLAY")
        applyFont(button.label, 13)
        button.label:SetAllPoints()
        button.label:SetJustifyH("CENTER")
        button.label:SetJustifyV("MIDDLE")
        button.label:SetText(label)
        button.label:SetTextColor(0.890, 0.690, 0.337)
        button.label:SetShadowColor(0, 0, 0, 0.85)
        button.label:SetShadowOffset(1, -1)
        button:SetScript("OnEnter", function(self)
          self.bg:SetVertexColor(0.26, 0.26, 0.26, 1)
        end)
        button:SetScript("OnLeave", function(self)
          self.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
        end)
        return button
      end
      guide.craftButton = makeCraftButton("Craft", 72)
      guide.craftAllButton = makeCraftButton("Craft All", 96)
      guide.craftButton:SetScript("OnClick", function()
        if guide.castCraft then guide.castCraft(guide.craftSpell, guide.craftName, 1) end
      end)
      guide.craftAllButton:SetScript("OnClick", function()
        if guide.castCraft then guide.castCraft(guide.craftSpell, guide.craftName, guide.craftAll) end
      end)
      guide.learnText = makeText(guide, 13, "LEFT")
      guide.learnText:SetWordWrap(true)
      guide.learnText:SetJustifyV("MIDDLE")
      guide.learnText:SetTextColor(1, 0.78, 0.45)
      slot.guide = guide
    end
    guide.wowcraftRetired = false
    guide.wowcraftKept = true
    WoWCraftShoppingHooks.guides[guideProfession] = guide
    sweepExtras("guide", guide)
    guide:SetParent(UIParent)
    if not guide.wowcraftDragReady then
      guide.wowcraftDragReady = true
      guide:SetMovable(true)
      guide:EnableMouse(true)
      guide:RegisterForDrag("LeftButton")
      guide:SetClampedToScreen(true)
    end
    if not guide.wowcraftDragging then
      guide:SetScript("OnDragStart", function(self)
        self.wowcraftDragging = true
        self:StartMoving()
      end)
      guide:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        self.wowcraftDragging = false
        local leftPos, topPos = self:GetLeft(), self:GetTop()
        if leftPos and topPos then
          self.userLeft = leftPos
          self.userTop = topPos
        end
      end)
    end
    if slot.guideAnchorStamp ~= guideStamp then
      slot.guideAnchorStamp = guideStamp
      guide.userLeft = nil
      guide.userTop = nil
      guide.recipePicks = {}
    end
    if slot.guideMinimized == nil then
      slot.guideMinimized = aura_env.saved.guideMinimized and true or false
    end
    aura_env.saved.guideMinimized = slot.guideMinimized and true or false
    local function textWidth(value, size)
      guide.applyFont(guide.measure, size)
      guide.measure:SetText(tostring(value or ""))
      return guide.measure:GetStringWidth() or 0
    end
    local function bagsOf(itemId)
      itemId = tonumber(itemId)
      if not itemId then return 0 end
      if type(inBags) == "table" and type(inBags[itemId]) == "number" then
        return inBags[itemId]
      end
      if C_Item and type(C_Item.GetItemCount) == "function" then
        local count = C_Item.GetItemCount(itemId, false)
        if type(count) == "number" then return count end
      end
      return 0
    end
    guide.countInBags = bagsOf
    local function craftsAffordable(mats, wanted)
      wanted = tonumber(wanted) or 0
      if wanted < 1 then return 0 end
      if type(mats) ~= "table" then return wanted end
      local limit = wanted
      for matIndex = 1, #mats do
        local each = tonumber(mats[matIndex].each) or 0
        if each > 0 then
          local have = bagsOf(mats[matIndex].id) or 0
          local fits = math.floor(have / each)
          if fits < limit then limit = fits end
        end
      end
      return limit
    end
    local function ensureShortPrompt()
      if guide.shortPrompt then return guide.shortPrompt end
      local prompt = CreateFrame("Frame", nil, guide)
      prompt:SetSize(440, 148)
      prompt:SetFrameStrata("DIALOG")
      prompt:SetFrameLevel(400)
      prompt:EnableMouse(true)
      prompt:SetClampedToScreen(true)
      prompt.bg = prompt:CreateTexture(nil, "BACKGROUND")
      prompt.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      prompt.bg:SetAllPoints()
      prompt.bg:SetVertexColor(0.09, 0.09, 0.09, 0.96)
      local function edge(point1, point2, wide)
        local line = prompt:CreateTexture(nil, "BORDER")
        line:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
        line:SetVertexColor(0.89, 0.55, 0.16, 1)
        line:SetPoint(point1)
        line:SetPoint(point2)
        if wide then line:SetHeight(1) else line:SetWidth(1) end
      end
      edge("TOPLEFT", "TOPRIGHT", true)
      edge("BOTTOMLEFT", "BOTTOMRIGHT", true)
      edge("TOPLEFT", "BOTTOMLEFT", false)
      edge("TOPRIGHT", "BOTTOMRIGHT", false)
      local function applyPromptFont(text, size)
        text:SetFontObject(GameFontHighlight)
        local font, _, flags = text:GetFont()
        if font then text:SetFont(font, size, flags or "OUTLINE") end
      end
      local function promptText(size, justify)
        local text = prompt:CreateFontString(nil, "OVERLAY")
        applyPromptFont(text, size)
        text:SetShadowColor(0, 0, 0, 0.85)
        text:SetShadowOffset(1, -1)
        text:SetJustifyH(justify)
        text:SetJustifyV("MIDDLE")
        return text
      end
      prompt.title = promptText(15, "LEFT")
      prompt.title:SetPoint("TOPLEFT", prompt, "TOPLEFT", 16, -14)
      prompt.title:SetSize(408, 20)
      prompt.title:SetText("Missing materials")
      prompt.title:SetTextColor(1, 0.78, 0.45)
      prompt.body = promptText(13, "LEFT")
      prompt.body:SetPoint("TOPLEFT", prompt, "TOPLEFT", 16, -42)
      prompt.body:SetSize(408, 52)
      prompt.body:SetWordWrap(true)
      prompt.body:SetJustifyV("TOP")
      prompt.body:SetTextColor(0.92, 0.92, 0.92)
      local function promptButton(label, width, r, g, b)
        local button = CreateFrame("Button", nil, prompt)
        button:SetSize(width, 26)
        button:RegisterForClicks("LeftButtonUp")
        button:EnableMouse(true)
        button.bg = button:CreateTexture(nil, "BACKGROUND")
        button.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
        button.bg:SetAllPoints()
        button.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
        button.label = button:CreateFontString(nil, "OVERLAY")
        applyPromptFont(button.label, 13)
        button.label:SetAllPoints()
        button.label:SetJustifyH("CENTER")
        button.label:SetJustifyV("MIDDLE")
        button.label:SetShadowColor(0, 0, 0, 0.85)
        button.label:SetShadowOffset(1, -1)
        button.label:SetText(label)
        button.label:SetTextColor(r, g, b)
        button:SetScript("OnEnter", function(self)
          self.bg:SetVertexColor(0.26, 0.26, 0.26, 1)
        end)
        button:SetScript("OnLeave", function(self)
          self.bg:SetVertexColor(0.16, 0.16, 0.16, 1)
        end)
        return button
      end
      prompt.craft = promptButton("Craft", 120, 0.890, 0.690, 0.337)
      prompt.cancel = promptButton("Cancel", 96, 0.9, 0.9, 0.9)
      prompt.ok = promptButton("OK", 96, 0.890, 0.690, 0.337)
      prompt.craft:SetPoint("BOTTOMRIGHT", prompt, "BOTTOMRIGHT", -16, 16)
      prompt.cancel:SetPoint("RIGHT", prompt.craft, "LEFT", -8, 0)
      prompt.ok:SetPoint("BOTTOMRIGHT", prompt, "BOTTOMRIGHT", -16, 16)
      prompt.craft:SetScript("OnClick", function()
        local count = tonumber(prompt.canCraft) or 0
        local spell = prompt.spellId
        local name = prompt.recipeName
        if count > 0 and guide.castCraft then
          guide.castCraft(spell, name, count)
        end
        prompt:Hide()
      end)
      prompt.cancel:SetScript("OnClick", function()
        prompt:Hide()
      end)
      prompt.ok:SetScript("OnClick", function()
        prompt:Hide()
      end)
      prompt:SetPoint("CENTER", UIParent, "CENTER", 0, 80)
      prompt:Hide()
      guide.shortPrompt = prompt
      return prompt
    end
    if guide.craftAllButton then
      guide.craftAllButton:SetScript("OnClick", function()
        local wanted = tonumber(guide.craftAll) or 0
        if wanted < 1 or not guide.castCraft then return end
        local can = craftsAffordable(guide.craftMats, wanted)
        if can >= wanted then
          guide.castCraft(guide.craftSpell, guide.craftName, wanted)
          return
        end
        local prompt = ensureShortPrompt()
        if prompt:GetParent() ~= guide then
          prompt:SetParent(guide)
        end
        prompt:SetFrameStrata("DIALOG")
        prompt:SetFrameLevel(400)
        prompt.canCraft = can
        prompt.spellId = guide.craftSpell
        prompt.recipeName = guide.craftName
        prompt.craft:SetScript("OnClick", function()
          local count = tonumber(prompt.canCraft) or 0
          local spell = prompt.spellId
          local name = prompt.recipeName
          if count > 0 and guide.castCraft then
            guide.castCraft(spell, name, count)
          end
          prompt:Hide()
        end)
        prompt:ClearAllPoints()
        prompt:SetPoint("CENTER", UIParent, "CENTER", 0, 80)
        prompt.craft:SetFrameLevel(prompt:GetFrameLevel() + 5)
        prompt.cancel:SetFrameLevel(prompt:GetFrameLevel() + 5)
        prompt.ok:SetFrameLevel(prompt:GetFrameLevel() + 5)
        prompt.body:SetText("You will only be able to complete " .. tostring(can) .. " out of " .. tostring(wanted) .. " crafts due to missing materials.")
        if can > 0 then
          prompt.craft.label:SetText("Craft " .. tostring(can))
          prompt.craft:SetWidth(math.max(96, prompt.craft.label:GetStringWidth() + 24))
          prompt.craft:Show()
          prompt.cancel:Show()
          prompt.ok:Hide()
        else
          prompt.craft:Hide()
          prompt.cancel:Hide()
          prompt.ok:Show()
        end
        prompt:Show()
      end)
    end
    if not guide.wowcraftShortHide then
      guide.wowcraftShortHide = true
      guide:SetScript("OnHide", function(self)
        if self.shortPrompt then self.shortPrompt:Hide() end
      end)
    end
    local nextStep = nextIndex and guideSteps[nextIndex]
    guide.recipePicks = guide.recipePicks or {}
    local activeOption = nextStep
    local activePick = 0
    if nextStep then
      local pick = guide.recipePicks[nextIndex]
      if type(pick) == "number" and pick >= 1 and type(nextStep.alts) == "table" and nextStep.alts[pick] then
        activeOption = nextStep.alts[pick]
        activeOption.fromSkill = nextStep.fromSkill
        activeOption.toSkill = nextStep.toSkill
        activePick = pick
      end
    end
    local function optionCraftCount(option, step)
      if not option or not step then return 0 end
      if type(guideSkill) ~= "number" then return option.crafts or step.crafts or 0 end
      if guideSkill >= step.toSkill then return 0 end
      local low = guideSkill
      if low < step.fromSkill then low = step.fromSkill end
      return craftsBetween(low, step.toSkill, option.yellow or step.yellow, option.gray or step.gray, option.crafts or step.crafts)
    end
    local nextCrafts = nextStep and optionCraftCount(activeOption, nextStep) or 0
    local activeMats = activeOption and activeOption.mats or nil
    local showMats = nextStep and nextCrafts > 0 and type(activeMats) == "table" and #activeMats > 0
    local fallbackQuality = {
      [0] = { 0.62, 0.62, 0.62, "ff9d9d9d" },
      [1] = { 1, 1, 1, "ffffffff" },
      [2] = { 0.12, 1, 0, "ff1eff00" },
      [3] = { 0, 0.44, 0.87, "ff0070dd" },
      [4] = { 0.64, 0.21, 0.93, "ffa335ee" },
      [5] = { 1, 0.5, 0, "ffff8000" },
      [6] = { 0.9, 0.8, 0.5, "ffe6cc80" },
      [7] = { 0, 0.8, 1, "ff00ccff" },
    }
    local function qualityParts(quality)
      quality = tonumber(quality) or 1
      if type(GetItemQualityColor) == "function" then
        local r, g, b, hex = GetItemQualityColor(quality)
        if type(r) == "number" and type(g) == "number" and type(b) == "number" then
          return r, g, b, hex
        end
      end
      if type(ITEM_QUALITY_COLORS) == "table" then
        local color = ITEM_QUALITY_COLORS[quality]
        if type(color) == "table" and type(color.r) == "number" then
          return color.r, color.g, color.b, color.hex
        end
      end
      local color = fallbackQuality[quality] or fallbackQuality[1]
      return color[1], color[2], color[3], color[4]
    end
    local function qualityColor(quality)
      local r, g, b = qualityParts(quality)
      return r, g, b
    end
    local function qualityHex(quality)
      local _, _, _, hex = qualityParts(quality)
      if type(hex) ~= "string" or hex == "" then return "|cffffffff" end
      if hex:sub(1, 2) == "|c" then return hex end
      return "|c" .. hex
    end
    local function moneyText(copper)
      copper = tonumber(copper) or 0
      local negative = copper < 0
      copper = math.floor(math.abs(copper) + 0.5)
      if negative and copper == 0 then negative = false end
      local gold = math.floor(copper / 10000)
      local silver = math.floor((copper % 10000) / 100)
      local coppers = copper % 100
      local parts = ""
      if gold > 0 then parts = "|cffffd100" .. gold .. "g|r" end
      if silver > 0 or gold > 0 then
        if parts ~= "" then parts = parts .. " " end
        parts = parts .. "|cffd1d5db" .. silver .. "s|r"
      end
      if parts ~= "" then parts = parts .. " " end
      parts = parts .. "|cfffb923c" .. coppers .. "c|r"
      if negative then return "-" .. parts end
      return parts
    end
    local function costLabel(copper)
      return "|cffffffffCost:|r " .. moneyText(copper)
    end
    local function returnRows(option)
      local info = option and option.returns
      if type(info) ~= "table" then return 0 end
      if info.kind == "disenchant" and type(info.items) == "table" and #info.items > 0 then
        return 1 + #info.items
      end
      if (tonumber(info.copper) or 0) > 0 then return 1 end
      return 0
    end
    local function optionCost(option, crafts)
      if not option then return 0 end
      return (tonumber(option.eachCost) or 0) * (tonumber(crafts) or 0) + (tonumber(option.recipeCost) or 0)
    end
    local function returnCopper(option, crafts)
      if type(option) ~= "table" or type(option.returns) ~= "table" then return 0 end
      return (tonumber(option.returns.copper) or 0) * (tonumber(crafts) or 0)
    end
    local function optionNet(option, crafts)
      if type(option) ~= "table" then return 0 end
      crafts = tonumber(crafts) or 0
      local spend = tonumber(option.eachSpend)
      if not spend then return optionCost(option, crafts) end
      return spend * crafts + (tonumber(option.recipeCost) or 0) - returnCopper(option, crafts)
    end
    local function sourceLabel(option)
      local text = option and option.sourceName or ""
      if type(text) ~= "string" or text == "" then return "" end
      if option.source == "item" then
        return qualityHex(option.sourceQuality) .. text .. "|r"
      end
      if option.source == "free" then return "|cffe3b056" .. text .. "|r" end
      return "|cffffffff" .. text .. "|r"
    end
    local function skillChance(step, level)
      local yellow = tonumber(step.yellow) or 0
      local gray = tonumber(step.gray) or tonumber(step.toSkill) or yellow
      level = tonumber(level) or tonumber(step.fromSkill) or 0
      if level < yellow then return 1 end
      if gray <= yellow or level >= gray then return 0 end
      return (gray - level) / (gray - yellow)
    end
    local function skillRange(step)
      local fromLevel = tonumber(step.fromSkill) or 0
      local toLevel = tonumber(step.toSkill) or fromLevel
      return tostring(fromLevel) .. "-" .. tostring(toLevel)
    end
    local function currentSkillInterval(step, level)
      local fromLevel = tonumber(step.fromSkill) or 0
      local toLevel = tonumber(step.toSkill) or fromLevel
      local shown = fromLevel
      if type(level) == "number" and level > shown then shown = math.floor(level + 0.5) end
      if shown > toLevel then shown = toLevel end
      return "|cffffffffSkill-interval:|r " .. tostring(shown) .. "-" .. tostring(toLevel)
    end
    local function chancePercentHex(chance)
      if chance < 0 then chance = 0 end
      if chance > 1 then chance = 1 end
      local function mix(fromValue, toValue, amount)
        return math.floor(fromValue + (toValue - fromValue) * amount + 0.5)
      end
      local red, green, blue
      if chance >= 0.5 then
        local amount = (chance - 0.5) / 0.5
        red = mix(255, 30, amount)
        green = mix(209, 255, amount)
        blue = 0
      else
        local amount = chance / 0.5
        red = 255
        green = mix(85, 209, amount)
        blue = mix(85, 0, amount)
      end
      return string.format("%02x%02x%02x", red, green, blue)
    end
    local function chanceText(step, level)
      local chance = skillChance(step, level)
      local pct = math.floor(chance * 100 + 0.5)
      return pct, "|cff" .. chancePercentHex(chance) .. tostring(pct) .. "%|r"
    end
    local function priceCompare(altCost, baseCost)
      altCost = tonumber(altCost) or 0
      baseCost = tonumber(baseCost) or 0
      local diff = altCost - baseCost
      if math.abs(diff) < 1 then return "|cffd1d5dbSame price|r" end
      local basis = math.abs(baseCost)
      if basis < 1 then
        if diff < 0 then return "|cff55ff55Cheaper|r" end
        return "|cffff5555More expensive|r"
      end
      local pct = math.floor(math.abs(diff) / basis * 100 + 0.5)
      if pct < 1 then return "|cffd1d5dbSame price|r" end
      if diff < 0 then
        return "|cff55ff55" .. tostring(pct) .. "% cheaper|r"
      end
      return "|cffff5555" .. tostring(pct) .. "% more expensive|r"
    end
    local title
    local titlePlain
    if slot.guideMinimized and nextStep then
      local level = type(skill) == "number" and skill or nextStep.fromSkill
      local pct, colored = chanceText(activeOption, level)
      titlePlain = "Next: " .. activeOption.name .. "  " .. pct .. "%"
      title = "|cffe3b056Next:|r " .. qualityHex(activeOption.quality) .. activeOption.name .. "|r  " .. colored
    elseif slot.guideMinimized then
      title = guideProfession .. " complete"
      titlePlain = title
    elseif choice ~= "full" and type(skill) == "number" then
      title = guideProfession .. " " .. skill
      titlePlain = title
    else
      title = guideProfession .. " Guide"
      titlePlain = title
    end
    local nameWidth = textWidth(titlePlain, 14)
    local skillWidth = textWidth("Skill", 12)
    local makeWidth = textWidth("Make", 12)
    local doneWidth = textWidth("Done", 13)
    if doneWidth > makeWidth then makeWidth = doneWidth end
    for index = 1, #guideSteps do
      local step = guideSteps[index]
      local measured = textWidth(step.name, 13)
      if index == nextIndex then
        local featuredWidth = textWidth(step.name, 15)
        if featuredWidth > measured then measured = featuredWidth end
      end
      if measured > nameWidth then nameWidth = measured end
      local rangeWidth = textWidth(tostring(step.fromSkill) .. "-" .. tostring(step.toSkill), 13)
      if rangeWidth > skillWidth then skillWidth = rangeWidth end
      local countWidth = textWidth(rowMake(step, index), 13)
      if index == nextIndex then
        local bigCount = textWidth(tostring(nextCrafts), 16)
        if bigCount > countWidth then countWidth = bigCount end
      end
      if countWidth > makeWidth then makeWidth = countWidth end
      if showMats and index == nextIndex and type(activeMats) == "table" then
        for matIndex = 1, #activeMats do
          local matWidth = textWidth(activeMats[matIndex].name, 13) + 22
          if matWidth > nameWidth then nameWidth = matWidth end
          local need = activeMats[matIndex].each * nextCrafts
          local have = bagsOf(activeMats[matIndex].id)
          local needWidth = textWidth(tostring(have) .. "/" .. tostring(need), 13)
          if needWidth > makeWidth then makeWidth = needWidth end
        end
      end
    end
    nameWidth = nameWidth + 28
    if nameWidth < 180 then nameWidth = 180 end
    if nameWidth > 360 then nameWidth = 360 end
    skillWidth = skillWidth + 2
    makeWidth = makeWidth + 2
    local padX, padY, rowHeight, columnGap = 12, 10, 20, 12
    local mainWidth = padX + nameWidth + skillWidth + makeWidth + columnGap * 2 + padX
    if nextStep then
      local chanceNeed = textWidth("Chance of level-up on next craft: 100%", 11) + padX * 2
      if chanceNeed > mainWidth then mainWidth = chanceNeed end
    end
    local altCount = 0
    if nextStep and type(nextStep.alts) == "table" and not slot.guideMinimized then
      altCount = #nextStep.alts
      if altCount > 2 then altCount = 2 end
    end
    local altWidth = altCount > 0 and 236 or 0
    local width = mainWidth + altWidth
    local nowReturnRows = returnRows(activeOption)
    local headerEnd, matH = 86, 20
    local nowH = headerEnd + nowReturnRows * 16
    local sourceH, bopH = 18, 18
    local function recipeLearned(spellId, name)
      spellId = tonumber(spellId)
      if not spellId or spellId <= 0 then return end
      if type(IsPlayerSpell) == "function" and IsPlayerSpell(spellId) then return true end
      if type(IsSpellKnown) == "function" and IsSpellKnown(spellId) then return true end
      if C_TradeSkillUI and type(C_TradeSkillUI.GetRecipeInfo) == "function" then
        local info = C_TradeSkillUI.GetRecipeInfo(spellId)
        if type(info) == "table" and type(info.learned) == "boolean" then
          return info.learned
        end
      end
      if guide.tradeIndex and guide.tradeIndex(spellId, name) then return true end
      local ready = false
      if C_TradeSkillUI and type(C_TradeSkillUI.IsTradeSkillReady) == "function" and C_TradeSkillUI.IsTradeSkillReady() then
        ready = true
      elseif type(GetNumTradeSkills) == "function" and (GetNumTradeSkills() or 0) > 0 then
        ready = true
      end
      if ready then return false end
    end
    local learned = activeOption and recipeLearned(activeOption.spell, activeOption.name)
    local showSource = learned == true
    local showBop = activeOption and activeOption.bop
    local matRows = 0
    if showMats and type(activeMats) == "table" then matRows = #activeMats end
    local craftH = nowH
    if nextStep then
      if matRows > 0 then craftH = craftH + 4 + matRows * matH end
      if showSource then craftH = craftH + 4 + sourceH end
      craftH = craftH + 8 + 26 + 16
      if showBop then craftH = craftH + bopH end
    else
      craftH = 22
    end
    local altTitleH = 0
    local altCardHeights = {}
    local function altCardHeight(option)
      local rows = 0
      if type(option) == "table" and type(option.mats) == "table" then rows = #option.mats end
      local matStart = 96 + returnRows(option) * 16
      if option and option.bop then matStart = matStart + 16 end
      return matStart + rows * 16 + 6
    end
    if altCount > 0 and nextStep then
      altTitleH = 22
      if activePick ~= 0 then
        altCardHeights[#altCardHeights + 1] = altCardHeight(nextStep)
      end
      local listed = #nextStep.alts
      if listed > 2 then listed = 2 end
      for altIndex = 1, listed do
        if altIndex ~= activePick then
          altCardHeights[#altCardHeights + 1] = altCardHeight(nextStep.alts[altIndex])
        end
      end
    end
    local featured = craftH
    if altTitleH > 0 then
      local altBody = altTitleH
      for altIndex = 1, #altCardHeights do
        altBody = altBody + altCardHeights[altIndex]
        if altIndex > 1 then altBody = altBody + 6 end
      end
      if altBody > featured then featured = altBody end
    end
    local listRows = 0
    for index = 1, #guideSteps do
      if index ~= nextIndex then
        local passed = type(guideSkill) == "number" and guideSkill >= guideSteps[index].toSkill
        if not passed then listRows = listRows + 1 end
      end
    end
    local bodyHeight = listRows * rowHeight
    local screenHeight = 900
    if type(GetScreenHeight) == "function" then
      local measuredScreen = GetScreenHeight()
      if type(measuredScreen) == "number" and measuredScreen > 200 then
        screenHeight = measuredScreen
      end
    end
    local chrome = padY + 18 + 8 + craftH + 8 + 1 + padY
    if listRows > 0 then chrome = chrome + 8 + rowHeight + 4 end
    local maxBody = math.floor(screenHeight * 0.72) - chrome
    if maxBody < rowHeight * 3 then maxBody = rowHeight * 3 end
    local visibleBody = bodyHeight
    if visibleBody > maxBody then visibleBody = maxBody end
    local height = padY + 18 + padY
    if not slot.guideMinimized then
      height = chrome + visibleBody
      if featured > craftH then
        local altHeight = padY + 18 + 8 + featured + padY
        if height < altHeight then height = altHeight end
      end
    end
    height = height + 14
    guide:SetSize(width, height)
    if not guide.watermark and guide.makeText then
      guide.watermark = guide.makeText(guide, 10, "RIGHT")
    end
    if guide.watermark then
      guide.watermark:ClearAllPoints()
      guide.watermark:SetPoint("BOTTOMRIGHT", guide, "BOTTOMRIGHT", -8, 4)
      guide.watermark:SetSize(110, 12)
      if guide.applyFont then guide.applyFont(guide.watermark, 10) end
      guide.watermark:SetText("WoWCraft.io")
      guide.watermark:SetTextColor(0.890, 0.690, 0.337)
      guide.watermark:SetAlpha(0.45)
      guide.watermark:Show()
    end
    if not slot.guideHostOpen or not guide:IsShown() then
      guide.userLeft = nil
      guide.userTop = nil
    end
    slot.guideHostOpen = true
    local anchored = false
    if guide.wowcraftDragging then
      anchored = true
    elseif guide.userLeft and guide.userTop then
      guide:ClearAllPoints()
      guide:SetFrameStrata("HIGH")
      guide:SetFrameLevel(100)
      guide:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", guide.userLeft, guide.userTop)
      anchored = true
    else
      local bounds = host
      local border = host.NineSlice
      if type(border) == "table" and type(border.GetLeft) == "function" and border:GetLeft() and border:GetTop() then
        bounds = border
      end
      local left = type(bounds.GetLeft) == "function" and bounds:GetLeft()
      local top = type(bounds.GetTop) == "function" and bounds:GetTop()
      if left and top then
        guide:ClearAllPoints()
        if type(host.GetFrameStrata) == "function" then
          guide:SetFrameStrata(host:GetFrameStrata() or "HIGH")
        end
        if type(host.GetFrameLevel) == "function" then
          guide:SetFrameLevel((host:GetFrameLevel() or 1) + 6)
        end
        local gap = 8
        if left >= width + gap then
          guide.wowcraftDock = "left"
          guide:SetPoint("TOPRIGHT", bounds, "TOPLEFT", -gap, 0)
        else
          guide.wowcraftDock = "right"
          guide:SetPoint("TOPLEFT", bounds, "TOPRIGHT", gap, 0)
        end
        anchored = true
      end
    end
    if anchored then
      guide:Show()
    end
    if type(skill) == "number" then
      syncPrompt(skill)
    else
      syncPrompt(remembered)
    end
    local function placeOn(parent, text, x, y, cellWidth, cellHeight)
      text:ClearAllPoints()
      text:SetSize(cellWidth, cellHeight)
      text:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
      text:Show()
    end
    placeOn(guide, guide.title, padX, -padY, width - padX * 2 - 28, 18)
    guide.title:SetText(title)
    guide.title:SetTextColor(0.890, 0.690, 0.337)
    guide.toggle:ClearAllPoints()
    guide.toggle:SetSize(22, 22)
    guide.toggle:SetPoint("TOPRIGHT", guide, "TOPRIGHT", -8, -(padY - 2))
    guide.toggle:Show()
    local function hideFeatured()
      guide.currentBg:Hide()
      guide.nowIcon:Hide()
      guide.nowTag:Hide()
      guide.nowName:Hide()
      guide.nowSkill:Hide()
      guide.nowCount:Hide()
      if guide.nowChance then guide.nowChance:Hide() end
      if guide.nowCost then guide.nowCost:Hide() end
      if guide.returnLines then
        for returnIndex = 1, #guide.returnLines do
          guide.returnLines[returnIndex].icon:Hide()
          guide.returnLines[returnIndex].text:Hide()
          if guide.returnLines[returnIndex].value then guide.returnLines[returnIndex].value:Hide() end
        end
      end
      if guide.nowSource then guide.nowSource:Hide() end
      if guide.nowSourceIcon then guide.nowSourceIcon:Hide() end
      if guide.nowBop then guide.nowBop:Hide() end
      if guide.altTitle then guide.altTitle:Hide() end
      guide.divider:Hide()
      for matIndex = 1, #guide.nowMats do
        local matLine = guide.nowMats[matIndex]
        matLine.icon:Hide()
        matLine.name:Hide()
        matLine.count:Hide()
      end
      if guide.craftButton then guide.craftButton:Hide() end
      if guide.craftAllButton then guide.craftAllButton:Hide() end
      if guide.learnText then guide.learnText:Hide() end
      if guide.learnIcon then guide.learnIcon:Hide() end
      if guide.altCards then
        for altIndex = 1, #guide.altCards do
          guide.altCards[altIndex]:Hide()
        end
      end
    end
    if slot.guideMinimized then
      guide.toggle.label:SetText("+")
      guide.headerName:Hide()
      guide.headerSkill:Hide()
      guide.headerMake:Hide()
      guide.scroll:Hide()
      hideFeatured()
      return
    end
    guide.toggle.label:SetText("-")
    guide.scroll:Show()
    local function applyIcon(texture, icon)
      if type(icon) == "string" and icon ~= "" then
        texture:SetTexture("Interface\\\\Icons\\\\" .. icon)
        texture:SetTexCoord(0.08, 0.92, 0.08, 0.92)
        texture:Show()
      else
        texture:SetTexture(nil)
        texture:Hide()
      end
    end
    local function qtyText(value)
      value = tonumber(value) or 0
      local rounded = math.floor(value + 0.5)
      if rounded < 0 then rounded = 0 end
      return tostring(rounded)
    end
    local function fillReturns(store, parent, option, crafts, left, top, lineWidth)
      local rows = {}
      local info = option and option.returns
      if type(info) == "table" then
        local total = (tonumber(info.copper) or 0) * (tonumber(crafts) or 0)
        local label = "Returns:"
        if info.kind == "vendor" then label = "Vendor:" end
        if info.kind == "auction" then label = "Auction:" end
        if info.kind == "disenchant" then label = "Disenchant:" end
        local items = info.kind == "disenchant" and type(info.items) == "table" and info.items or nil
        if items and #items > 0 then
          rows[#rows + 1] = { text = "|cffffffff" .. label .. "|r " .. moneyText(total) }
          for itemIndex = 1, #items do
            local item = items[itemIndex]
            local qty = (tonumber(item.each) or 0) * (tonumber(crafts) or 0)
            local value = (tonumber(item.copper) or 0) * (tonumber(crafts) or 0)
            rows[#rows + 1] = {
              icon = item.icon,
              name = qualityHex(item.quality) .. (item.name or "") .. "|r",
              suffix = "|cffffffffx" .. qtyText(qty) .. "|r  " .. moneyText(value),
            }
          end
        elseif total > 0 then
          rows[#rows + 1] = { text = "|cffffffff" .. label .. "|r " .. moneyText(total) }
        end
      end
      for rowIndex = 1, #rows do
        local line = store[rowIndex]
        if not line then
          line = {
            icon = parent:CreateTexture(nil, "ARTWORK"),
            text = guide.makeText(parent, 12, "LEFT"),
            value = guide.makeText(parent, 12, "RIGHT"),
          }
          line.icon:SetSize(14, 14)
          store[rowIndex] = line
        end
        if not line.value then
          line.value = guide.makeText(parent, 12, "RIGHT")
        end
        local rowY = top - (rowIndex - 1) * 16
        local row = rows[rowIndex]
        if row.icon then
          local suffixWidth = textWidth(row.suffix, 12) + 6
          local nameWidth = lineWidth - 18 - suffixWidth
          if nameWidth < 0 then nameWidth = 0 end
          line.icon:ClearAllPoints()
          line.icon:SetPoint("TOPLEFT", parent, "TOPLEFT", left, rowY + 1)
          applyIcon(line.icon, row.icon)
          line.text:ClearAllPoints()
          line.text:SetPoint("TOPLEFT", parent, "TOPLEFT", left + 18, rowY)
          line.text:SetSize(nameWidth, 16)
          line.text:SetText(row.name)
          line.value:ClearAllPoints()
          line.value:SetPoint("TOPLEFT", parent, "TOPLEFT", left + 18 + nameWidth, rowY)
          line.value:SetSize(suffixWidth, 16)
          line.value:SetText(row.suffix)
          line.value:SetTextColor(1, 1, 1)
          line.value:Show()
        else
          line.icon:Hide()
          line.value:Hide()
          line.text:ClearAllPoints()
          line.text:SetPoint("TOPLEFT", parent, "TOPLEFT", left, rowY)
          line.text:SetSize(lineWidth, 16)
          line.text:SetText(row.text)
        end
        line.text:SetTextColor(1, 1, 1)
        line.text:Show()
      end
      for rowIndex = #rows + 1, #store do
        store[rowIndex].icon:Hide()
        store[rowIndex].text:Hide()
        if store[rowIndex].value then store[rowIndex].value:Hide() end
      end
    end
    local skillX = padX + nameWidth + columnGap
    local makeX = skillX + skillWidth + columnGap
    local textX = padX + 40
    local featuredTop = -(padY + 18 + 8)
    guide.currentBg:ClearAllPoints()
    guide.currentBg:SetPoint("TOPLEFT", guide, "TOPLEFT", 6, featuredTop + 4)
    guide.currentBg:SetPoint("BOTTOMRIGHT", guide, "TOPLEFT", mainWidth - 6, featuredTop - craftH)
    guide.currentBg:Show()
    if nextStep then
      placeOn(guide, guide.nowIcon, padX, featuredTop, 32, 32)
      applyIcon(guide.nowIcon, activeOption.icon)
      placeOn(guide, guide.nowTag, textX, featuredTop, nameWidth - 28, 14)
      guide.nowTag:SetText("Next craft")
      guide.nowTag:SetTextColor(0.490, 0.827, 0.988)
      placeOn(guide, guide.nowName, textX, featuredTop - 14, nameWidth - 28, 18)
      guide.nowName:SetText(activeOption.name)
      local nameR, nameG, nameB = qualityColor(activeOption.quality)
      guide.nowName:SetTextColor(nameR, nameG, nameB)
      local liveLevel = type(skill) == "number" and skill or nextStep.fromSkill
      placeOn(guide, guide.nowSkill, textX, featuredTop - 32, mainWidth - textX - padX, 20)
      if guide.applyFont then guide.applyFont(guide.nowSkill, 16) end
      guide.nowSkill:SetText(currentSkillInterval(nextStep, liveLevel))
      guide.nowSkill:SetTextColor(1, 1, 1)
      if not guide.nowCost and guide.makeText then
        guide.nowCost = guide.makeText(guide, 13, "LEFT")
      end
      guide.nowCount:SetJustifyH("LEFT")
      placeOn(guide, guide.nowCount, textX, featuredTop - 52, nameWidth - 28, 16)
      guide.nowCount:SetText("|cffffffffRemaining Crafts:|r |cffe3b056" .. tostring(nextCrafts) .. "|r")
      guide.nowCount:SetTextColor(1, 1, 1)
      if guide.nowCost then
        placeOn(guide, guide.nowCost, textX, featuredTop - 68, nameWidth - 28, 16)
        guide.nowCost:SetText(costLabel(optionNet(activeOption, nextCrafts)))
        guide.nowCost:SetTextColor(1, 1, 1)
      end
      guide.returnLines = guide.returnLines or {}
      fillReturns(guide.returnLines, guide, activeOption, nextCrafts, textX, featuredTop - headerEnd, nameWidth - 28)
      local shownMats = 0
      if showMats then
        local matY = featuredTop - nowH - 4
        for matIndex = 1, #activeMats do
          shownMats = shownMats + 1
          local mat = activeMats[matIndex]
          local matLine = guide.nowMats[shownMats]
          if not matLine then
            matLine = {
              icon = guide:CreateTexture(nil, "ARTWORK"),
              name = guide.makeText(guide, 13, "LEFT"),
              count = guide.makeText(guide, 13, "RIGHT"),
            }
            matLine.icon:SetSize(16, 16)
            guide.nowMats[shownMats] = matLine
          end
          local matTop = matY - (shownMats - 1) * matH
          placeOn(guide, matLine.icon, padX + 8, matTop + 2, 16, 16)
          applyIcon(matLine.icon, mat.icon)
          placeOn(guide, matLine.name, padX + 30, matTop, nameWidth - 8, matH)
          matLine.name:SetText(mat.name)
          matLine.name:SetTextColor(0.9, 0.9, 0.9)
          placeOn(guide, matLine.count, makeX, matTop, makeWidth, matH)
          local need = mat.each * nextCrafts
          local have = bagsOf(mat.id)
          local haveColor = "ff5555"
          if have >= need then haveColor = "55ff55" end
          matLine.count:SetText("|cff" .. haveColor .. tostring(have) .. "|r|cff7dd3fc/" .. tostring(need) .. "|r")
          matLine.count:SetTextColor(1, 1, 1)
        end
      end
      for matIndex = shownMats + 1, #guide.nowMats do
        local matLine = guide.nowMats[matIndex]
        matLine.icon:Hide()
        matLine.name:Hide()
        matLine.count:Hide()
      end
      local infoTop = featuredTop - nowH - 4
      if matRows > 0 then infoTop = infoTop - matRows * matH - 4 end
      if showSource then
        if not guide.nowSourceIcon then
          guide.nowSourceIcon = guide:CreateTexture(nil, "ARTWORK")
          guide.nowSourceIcon:SetSize(16, 16)
        end
        if not guide.nowSource and guide.makeText then
          guide.nowSource = guide.makeText(guide, 12, "LEFT")
        end
        guide.nowSourceIcon:ClearAllPoints()
        guide.nowSourceIcon:SetPoint("TOPLEFT", guide, "TOPLEFT", padX, infoTop - 1)
        applyIcon(guide.nowSourceIcon, activeOption.sourceIcon)
        if guide.nowSource then
          placeOn(guide, guide.nowSource, padX + 20, infoTop, mainWidth - padX - 32, sourceH)
          guide.nowSource:SetText(sourceLabel(activeOption))
          guide.nowSource:SetTextColor(1, 1, 1)
        end
      else
        if guide.nowSource then guide.nowSource:Hide() end
        if guide.nowSourceIcon then guide.nowSourceIcon:Hide() end
      end
      local bopExtra = 0
      if showBop then bopExtra = bopH end
      local chanceH = 16
      local actionTop = featuredTop - craftH + bopExtra + chanceH + 26
      guide.craftSpell = activeOption.spell
      guide.craftName = activeOption.name
      guide.craftAll = nextCrafts
      guide.craftMats = activeMats
      if learned == false then
        if guide.craftButton then guide.craftButton:Hide() end
        if guide.craftAllButton then guide.craftAllButton:Hide() end
        if guide.learnText then
          local sourceText = activeOption.sourceName
          if type(sourceText) ~= "string" or sourceText == "" then sourceText = "Unknown source" end
          local nameText = "|cffff5555" .. sourceText .. "|r"
          if activeOption.source == "item" then
            nameText = qualityHex(activeOption.sourceQuality) .. sourceText .. "|r"
          end
          if not guide.learnIcon then
            guide.learnIcon = guide:CreateTexture(nil, "ARTWORK")
            guide.learnIcon:SetSize(16, 16)
          end
          guide.learnIcon:ClearAllPoints()
          guide.learnIcon:SetPoint("TOPLEFT", guide, "TOPLEFT", padX, actionTop - 5)
          applyIcon(guide.learnIcon, activeOption.sourceIcon)
          guide.learnText:ClearAllPoints()
          guide.learnText:SetPoint("TOPLEFT", guide, "TOPLEFT", padX + 22, actionTop)
          guide.learnText:SetSize(width - padX * 2 - 22, 26)
          guide.learnText:SetText("|cffff5555Not learned:|r " .. nameText)
          guide.learnText:SetTextColor(1, 1, 1)
          guide.learnText:Show()
        end
      else
        if guide.learnText then guide.learnText:Hide() end
        if guide.learnIcon then guide.learnIcon:Hide() end
        if guide.craftButton then
          guide.craftButton:ClearAllPoints()
          guide.craftButton:SetPoint("TOPLEFT", guide, "TOPLEFT", padX, actionTop)
          guide.craftButton:Show()
        end
        if guide.craftAllButton then
          if nextCrafts > 1 then
            local allLabel = "Craft All ( " .. tostring(nextCrafts) .. " )"
            guide.craftAllButton.label:SetText(allLabel)
            local allWidth = textWidth(allLabel, 13) + 16
            if allWidth < 96 then allWidth = 96 end
            guide.craftAllButton:SetWidth(allWidth)
            guide.craftAllButton:ClearAllPoints()
            guide.craftAllButton:SetPoint("TOPLEFT", guide, "TOPLEFT", padX + 80, actionTop)
            guide.craftAllButton:Show()
          else
            guide.craftAllButton:Hide()
          end
        end
      end
      if not guide.nowChance and guide.makeText then
        guide.nowChance = guide.makeText(guide, 11, "LEFT")
      end
      if guide.nowChance then
        local _, chanceColored = chanceText(activeOption, liveLevel)
        if guide.applyFont then guide.applyFont(guide.nowChance, 11) end
        placeOn(guide, guide.nowChance, padX, featuredTop - craftH + 14, mainWidth - padX * 2, 14)
        guide.nowChance:SetText("|cffffffffChance of level-up on next craft:|r " .. chanceColored)
        guide.nowChance:SetTextColor(1, 1, 1)
      end
      if not guide.nowBop and guide.makeText then
        guide.nowBop = guide.makeText(guide, 13, "LEFT")
      end
      if guide.nowBop then
        if showBop then
          if guide.applyFont then guide.applyFont(guide.nowBop, 13) end
          placeOn(guide, guide.nowBop, padX + 22, featuredTop - craftH + chanceH + bopH, mainWidth - padX * 2 - 22, bopH)
          guide.nowBop:SetText("|cffff5555Warning:|r |cffffffffRecipe is a BoP drop|r")
          guide.nowBop:SetTextColor(1, 1, 1)
        else
          guide.nowBop:Hide()
        end
      end
    else
      guide.nowIcon:Hide()
      guide.nowTag:Hide()
      guide.nowSkill:Hide()
      guide.nowCount:Hide()
      if guide.nowChance then guide.nowChance:Hide() end
      if guide.nowCost then guide.nowCost:Hide() end
      if guide.returnLines then
        for returnIndex = 1, #guide.returnLines do
          guide.returnLines[returnIndex].icon:Hide()
          guide.returnLines[returnIndex].text:Hide()
          if guide.returnLines[returnIndex].value then guide.returnLines[returnIndex].value:Hide() end
        end
      end
      if guide.nowSource then guide.nowSource:Hide() end
      if guide.nowSourceIcon then guide.nowSourceIcon:Hide() end
      if guide.nowBop then guide.nowBop:Hide() end
      if guide.altTitle then guide.altTitle:Hide() end
      placeOn(guide, guide.nowName, padX, featuredTop, nameWidth, 20)
      guide.nowName:SetText("Guide complete")
      guide.nowName:SetTextColor(0.333, 1, 0.333)
      for matIndex = 1, #guide.nowMats do
        local matLine = guide.nowMats[matIndex]
        matLine.icon:Hide()
        matLine.name:Hide()
        matLine.count:Hide()
      end
      if guide.craftButton then guide.craftButton:Hide() end
      if guide.craftAllButton then guide.craftAllButton:Hide() end
      if guide.learnText then guide.learnText:Hide() end
      if guide.learnIcon then guide.learnIcon:Hide() end
      if guide.altCards then
        for altIndex = 1, #guide.altCards do
          guide.altCards[altIndex]:Hide()
        end
      end
    end
    local function hideAltCards()
      if not guide.altCards then return end
      for altIndex = 1, #guide.altCards do
        guide.altCards[altIndex]:Hide()
      end
    end
    local function ensureAltCard(index)
      guide.altCards = guide.altCards or {}
      local card = guide.altCards[index]
      if card then return card end
      card = CreateFrame("Button", nil, guide)
      card:RegisterForClicks("LeftButtonUp")
      card:EnableMouse(true)
      card.bg = card:CreateTexture(nil, "BACKGROUND")
      card.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      card.bg:SetAllPoints()
      card.bg:SetVertexColor(0.14, 0.14, 0.14, 0.92)
      card.icon = card:CreateTexture(nil, "ARTWORK")
      card.icon:SetSize(20, 20)
      card.name = guide.makeText(card, 13, "LEFT")
      card.quantity = guide.makeText(card, 12, "LEFT")
      card.cost = guide.makeText(card, 12, "LEFT")
      card.compare = guide.makeText(card, 11, "LEFT")
      card.sourceIcon = card:CreateTexture(nil, "ARTWORK")
      card.sourceIcon:SetSize(14, 14)
      card.source = guide.makeText(card, 11, "LEFT")
      card.bop = guide.makeText(card, 13, "LEFT")
      card.bop:SetWordWrap(false)
      card.mats = {}
      card:SetScript("OnClick", function(self)
        guide.recipePicks = guide.recipePicks or {}
        if self.stepIndex then
          guide.recipePicks[self.stepIndex] = self.pickId or 0
        end
      end)
      card:SetScript("OnEnter", function(self)
        self.bg:SetVertexColor(0.24, 0.24, 0.24, 0.96)
      end)
      card:SetScript("OnLeave", function(self)
        self.bg:SetVertexColor(0.14, 0.14, 0.14, 0.92)
      end)
      guide.altCards[index] = card
      return card
    end
    if not guide.altTitle and guide.makeText then
      guide.altTitle = guide.makeText(guide, 16, "LEFT")
    end
    if not nextStep or altCount < 1 or slot.guideMinimized then
      hideAltCards()
      if guide.altTitle then guide.altTitle:Hide() end
    else
      if guide.altTitle then
        placeOn(guide, guide.altTitle, mainWidth + 8, featuredTop, altWidth - 16, 20)
        if guide.applyFont then guide.applyFont(guide.altTitle, 16) end
        guide.altTitle:SetText("Alternative Recipes")
        guide.altTitle:SetTextColor(0.890, 0.690, 0.337)
      end
      local choices = { { id = 0, option = nextStep } }
      for altIndex = 1, #nextStep.alts do
        local alt = nextStep.alts[altIndex]
        alt.fromSkill = nextStep.fromSkill
        alt.toSkill = nextStep.toSkill
        choices[#choices + 1] = { id = altIndex, option = alt }
      end
      local shownAlts = {}
      for choiceIndex = 1, #choices do
        if choices[choiceIndex].id ~= activePick then
          shownAlts[#shownAlts + 1] = choices[choiceIndex]
        end
      end
      local cardGap = 6
      local cardY = featuredTop - altTitleH
      local innerW = altWidth - 14
      for shownIndex = 1, #shownAlts do
        local choice = shownAlts[shownIndex]
        local option = choice.option
        local card = ensureAltCard(shownIndex)
        local cardH = altCardHeights[shownIndex] or altCardHeight(option)
        card.mats = card.mats or {}
        card:ClearAllPoints()
        card:SetPoint("TOPLEFT", guide, "TOPLEFT", mainWidth + 6, cardY)
        card:SetSize(innerW, cardH)
        card.stepIndex = nextIndex
        card.pickId = choice.id
        card.icon:ClearAllPoints()
        card.icon:SetPoint("TOPLEFT", card, "TOPLEFT", 8, -8)
        applyIcon(card.icon, option.icon)
        card.name:ClearAllPoints()
        card.name:SetPoint("TOPLEFT", card, "TOPLEFT", 34, -8)
        card.name:SetSize(innerW - 42, 18)
        card.name:SetText(option.name or "")
        local altR, altG, altB = qualityColor(option.quality)
        card.name:SetTextColor(altR, altG, altB)
        card.name:Show()
        local altCrafts = optionCraftCount(option, nextStep)
        if not card.quantity and guide.makeText then
          card.quantity = guide.makeText(card, 12, "LEFT")
        end
        if card.quantity then
          card.quantity:ClearAllPoints()
          card.quantity:SetPoint("TOPLEFT", card, "TOPLEFT", 34, -28)
          card.quantity:SetSize(innerW - 42, 16)
          card.quantity:SetText("|cffffffffQuantity:|r |cffe3b056" .. tostring(altCrafts) .. "|r")
          card.quantity:SetTextColor(1, 1, 1)
          card.quantity:Show()
        end
        card.cost:ClearAllPoints()
        card.cost:SetPoint("TOPLEFT", card, "TOPLEFT", 34, -44)
        card.cost:SetSize(innerW - 42, 16)
        local altCost = optionNet(option, altCrafts)
        card.cost:SetText(costLabel(altCost))
        card.cost:SetTextColor(1, 1, 1)
        card.cost:Show()
        card.returns = card.returns or {}
        local returnShift = returnRows(option) * 16
        fillReturns(card.returns, card, option, altCrafts, 8, -76, innerW - 16)
        if not card.compare and guide.makeText then
          card.compare = guide.makeText(card, 11, "LEFT")
        end
        if card.compare then
          card.compare:ClearAllPoints()
          card.compare:SetPoint("TOPLEFT", card, "TOPLEFT", 34, -60)
          card.compare:SetSize(innerW - 42, 16)
          card.compare:SetText(priceCompare(optionNet(option, altCrafts), optionNet(activeOption, nextCrafts)))
          card.compare:SetTextColor(1, 1, 1)
          card.compare:Show()
        end
        card.sourceIcon:ClearAllPoints()
        card.sourceIcon:SetPoint("TOPLEFT", card, "TOPLEFT", 8, -80 - returnShift)
        applyIcon(card.sourceIcon, option.sourceIcon)
        card.source:ClearAllPoints()
        card.source:SetPoint("TOPLEFT", card, "TOPLEFT", 26, -78 - returnShift)
        card.source:SetSize(innerW - 34, 16)
        card.source:SetText(sourceLabel(option))
        card.source:SetTextColor(1, 1, 1)
        card.source:Show()
        local matTop = -96 - returnShift
        if option.bop then
          card.bop:ClearAllPoints()
          card.bop:SetPoint("TOPLEFT", card, "TOPLEFT", 26, -92 - returnShift)
          card.bop:SetSize(innerW - 34, 18)
          if guide.applyFont then guide.applyFont(card.bop, 13) end
          card.bop:SetText("|cffff5555Warning:|r |cffffffffRecipe is a BoP drop|r")
          card.bop:SetTextColor(1, 1, 1)
          card.bop:Show()
          matTop = -112 - returnShift
        else
          card.bop:Hide()
        end
        local matRowsShown = 0
        local optionMats = option.mats
        if type(optionMats) == "table" then
          for matIndex = 1, #optionMats do
            matRowsShown = matRowsShown + 1
            local mat = optionMats[matIndex]
            local matLine = card.mats[matRowsShown]
            if not matLine then
              matLine = {
                icon = card:CreateTexture(nil, "ARTWORK"),
                name = guide.makeText(card, 11, "LEFT"),
                count = guide.makeText(card, 11, "RIGHT"),
              }
              matLine.icon:SetSize(14, 14)
              card.mats[matRowsShown] = matLine
            end
            local rowY = matTop - (matRowsShown - 1) * 16
            matLine.icon:ClearAllPoints()
            matLine.icon:SetPoint("TOPLEFT", card, "TOPLEFT", 8, rowY + 1)
            applyIcon(matLine.icon, mat.icon)
            matLine.name:ClearAllPoints()
            matLine.name:SetPoint("TOPLEFT", card, "TOPLEFT", 26, rowY)
            matLine.name:SetSize(innerW - 92, 16)
            matLine.name:SetText(mat.name or "")
            matLine.name:SetTextColor(0.9, 0.9, 0.9)
            matLine.name:Show()
            local need = (tonumber(mat.each) or 0) * altCrafts
            local have = bagsOf(mat.id)
            local haveColor = "ff5555"
            if have >= need then haveColor = "55ff55" end
            matLine.count:ClearAllPoints()
            matLine.count:SetPoint("TOPRIGHT", card, "TOPRIGHT", -8, rowY)
            matLine.count:SetSize(58, 16)
            matLine.count:SetText("|cff" .. haveColor .. tostring(have) .. "|r|cff7dd3fc/" .. tostring(need) .. "|r")
            matLine.count:SetTextColor(1, 1, 1)
            matLine.count:Show()
          end
        end
        for hiddenMat = matRowsShown + 1, #card.mats do
          local matLine = card.mats[hiddenMat]
          matLine.icon:Hide()
          matLine.name:Hide()
          matLine.count:Hide()
        end
        card:Show()
        cardY = cardY - cardH - cardGap
      end
      for hiddenIndex = #shownAlts + 1, #(guide.altCards or {}) do
        guide.altCards[hiddenIndex]:Hide()
      end
    end
    local dividerAnchor = craftH
    if listRows == 0 then dividerAnchor = featured end
    local dividerY = featuredTop - dividerAnchor - 8
    guide.divider:ClearAllPoints()
    guide.divider:SetPoint("TOPLEFT", guide, "TOPLEFT", padX, dividerY)
    guide.divider:SetPoint("TOPRIGHT", guide, "TOPLEFT", mainWidth - padX, dividerY)
    guide.divider:Show()
    if listRows == 0 then
      guide.headerName:Hide()
      guide.headerSkill:Hide()
      guide.headerMake:Hide()
      guide.scroll:Hide()
      return
    end
    local headerY = dividerY - 8
    placeOn(guide, guide.headerName, padX + 22, headerY, nameWidth - 22, rowHeight)
    guide.headerName:SetText("Recipe")
    guide.headerName:SetTextColor(0.64, 0.64, 0.64)
    placeOn(guide, guide.headerSkill, skillX, headerY, skillWidth, rowHeight)
    guide.headerSkill:SetText("Skill")
    guide.headerSkill:SetTextColor(0.64, 0.64, 0.64)
    placeOn(guide, guide.headerMake, makeX, headerY, makeWidth, rowHeight)
    guide.headerMake:SetText("Make")
    guide.headerMake:SetTextColor(0.64, 0.64, 0.64)
    guide.scroll:ClearAllPoints()
    guide.scroll:SetPoint("TOPLEFT", guide, "TOPLEFT", 0, headerY - rowHeight - 4)
    guide.scroll:SetSize(mainWidth, visibleBody)
    guide.content:SetSize(mainWidth, bodyHeight)
    local function lineAt(index)
      local line = guide.lines[index]
      if not line then
        line = {
          icon = guide.content:CreateTexture(nil, "ARTWORK"),
          name = guide.makeText(guide.content, 13, "LEFT"),
          skill = guide.makeText(guide.content, 13, "RIGHT"),
          count = guide.makeText(guide.content, 13, "RIGHT"),
        }
        line.icon:SetSize(16, 16)
        guide.lines[index] = line
      end
      return line
    end
    local function hideLine(line)
      if line.icon then line.icon:Hide() end
      line.name:Hide()
      line.skill:Hide()
      line.count:Hide()
    end
    local drawn = 0
    local function draw(icon, nameText, skillText, countText, nameR, nameG, nameB, countR, countG, countB)
      drawn = drawn + 1
      local line = lineAt(drawn)
      local y = -((drawn - 1) * rowHeight)
      placeOn(guide.content, line.icon, padX, y + 2, 16, 16)
      applyIcon(line.icon, icon)
      placeOn(guide.content, line.name, padX + 22, y, nameWidth - 22, rowHeight)
      line.name:SetText(nameText)
      line.name:SetTextColor(nameR, nameG, nameB)
      placeOn(guide.content, line.skill, skillX, y, skillWidth, rowHeight)
      line.skill:SetText(skillText)
      line.skill:SetTextColor(1, 1, 1)
      placeOn(guide.content, line.count, makeX, y, makeWidth, rowHeight)
      line.count:SetText(countText)
      line.count:SetTextColor(countR, countG, countB)
    end
    for index = 1, #guideSteps do
      local passed = type(guideSkill) == "number" and guideSkill >= guideSteps[index].toSkill
      if index ~= nextIndex and not passed then
        local step = guideSteps[index]
        local nameR, nameG, nameB = qualityColor(step.quality)
        draw(step.icon, step.name, skillRange(step), rowMake(step, index), nameR, nameG, nameB, 1, 1, 1)
      end
    end
    for index = drawn + 1, #guide.lines do
      hideLine(guide.lines[index])
    end
    if slot.guideSeenNext ~= nextIndex then
      slot.guideSeenNext = nextIndex
      guide.scroll:SetVerticalScroll(0)
    end
  end
`;
}

/**
 * Custom text runs in WoW (Lua 5.1). Red is still missing from bags, yellow is
 * remembered auction-house buyouts, green is the current bag count.
 * The guide frame is separate and only shows while the professions window is open.
 */
function customTextSource(title: string, rows: ShoppingRow[], profession: string, steps: GuideStep[]): string {
  const itemLines = rows.map((row) => `    { id = ${row.id}, name = ${luaString(row.name)}, need = ${row.need}, source = ${luaString(row.source)}, icon = ${luaString(row.icon)}, quality = ${row.quality}, copper = ${row.copper} },`).join('\n');
  return `function()
  local items = {
${itemLines}
  }
  WoWCraftShoppingHooks = WoWCraftShoppingHooks or { auras = {} }
  local slot = WoWCraftShoppingHooks.auras[aura_env.id]
  if not slot then
    slot = { pending = {} }
    WoWCraftShoppingHooks.auras[aura_env.id] = slot
  end
  if not slot.cleanup then
    slot.cleanup = function()
      if slot.cleaned then return end
      slot.cleaned = true
      slot.released = true
      if slot.panel then
        slot.panel:SetScript("OnUpdate", nil)
        slot.panel:Hide()
      end
      if slot.frame then
        slot.frame:UnregisterAllEvents()
        slot.frame:SetScript("OnEvent", nil)
        slot.frame:Hide()
      end
      if slot.copyButton then slot.copyButton:Hide() end
      if slot.guide then slot.guide:Hide() end
      if slot.guidePrompt then slot.guidePrompt:Hide() end
      local host = ProfessionsFrame
      if type(host) == "table" then
        local names = {
          "ProfessionsOverviewTab",
          "Professions1Tab",
          "Professions2Tab",
          "Professions3Tab",
          "Professions4Tab",
          "Professions5Tab",
        }
        for i = 1, #names do
          local tab = host[names[i]]
          if type(tab) == "table" then
            tab.wowcraftMoving = true
            if tab.wowcraftBasePoint and type(tab.SetPoint) == "function" then
              tab:ClearAllPoints()
              tab:SetPoint(tab.wowcraftBasePoint, tab.wowcraftBaseRelative or host, tab.wowcraftBaseRelativePoint or tab.wowcraftBasePoint, tab.wowcraftBaseX or 0, tab.wowcraftBaseY or 0)
            end
          end
        end
      end
    end
  end
  if not slot.watch then
    slot.watch = function()
      if GetTime() - (slot.seen or 0) > 1 then
        slot.cleanup()
      end
    end
  end
  slot.seen = GetTime()
  slot.released = false
  slot.cleaned = false
  local function wanted(itemId)
      return slot.wanted and slot.wanted[itemId]
    end
    local function push(itemId, count, kind)
      itemId = tonumber(itemId)
      count = tonumber(count) or 1
      if not itemId or count < 1 or not wanted(itemId) then return end
      local now = GetTime()
      local last = slot.pending[#slot.pending]
      if last and last.id == itemId and now - last.time < 2 then
        last.count = count
        last.kind = kind
        last.time = now
        return
      end
      slot.pending[#slot.pending + 1] = { id = itemId, count = count, kind = kind, time = now }
    end
    local function takeOldest()
      local now = GetTime()
      while slot.pending[1] and now - slot.pending[1].time > 15 do
        table.remove(slot.pending, 1)
      end
      local row = table.remove(slot.pending, 1)
      if not row then return end
      return row.id, row.count
    end
    local function takePending(itemId, kind)
      local now = GetTime()
      local found
      local i = 1
      while i <= #slot.pending do
        local row = slot.pending[i]
        if now - row.time > 15 then
          table.remove(slot.pending, i)
        elseif not found and row.id == itemId and row.kind == kind then
          found = row.count
          table.remove(slot.pending, i)
        else
          i = i + 1
        end
      end
      return found
    end
    local function commit(itemId, count)
      if not wanted(itemId) or not count or count < 1 then return end
      slot.bought = slot.bought or {}
      slot.bought[itemId] = (slot.bought[itemId] or 0) + count
      local saved = slot.saved and slot.saved.bought
      if type(saved) == "table" then saved[itemId] = slot.bought[itemId] end
    end
    if not slot.hooks and type(PlaceAuctionBid) == "function" and type(hooksecurefunc) == "function" then
      hooksecurefunc("PlaceAuctionBid", function(listType, index, bid)
        if listType ~= "list" or type(GetAuctionItemLink) ~= "function" then return end
        local link = GetAuctionItemLink(listType, index)
        local itemId = link and tonumber(link:match("item:(%d+)"))
        local infoCount, buyout
        if type(GetAuctionItemInfo) == "function" then
          local _, _, count, _, _, _, _, _, _, buyoutPrice = GetAuctionItemInfo(listType, index)
          infoCount = count
          buyout = buyoutPrice
        end
        local count = tonumber(infoCount) or 1
        if count < 1 then count = 1 end
        buyout = tonumber(buyout) or 0
        bid = tonumber(bid) or 0
        if itemId and buyout > 0 and bid >= buyout then
          push(itemId, count, "bid")
        end
      end)
    end
    if not slot.hooks and C_AuctionHouse and type(C_AuctionHouse.ConfirmCommoditiesPurchase) == "function" and type(hooksecurefunc) == "function" then
      hooksecurefunc(C_AuctionHouse, "ConfirmCommoditiesPurchase", function(itemId, quantity)
        push(itemId, quantity, "commodity")
      end)
    end
    slot.hooks = true
    if slot.chatRevision ~= 5 then
    if slot.frame then
      slot.frame:UnregisterAllEvents()
      slot.frame:SetScript("OnEvent", nil)
    end
    slot.chatRevision = 5
    local frame = CreateFrame("Frame")
    slot.frame = frame
    local function wonPattern(template)
      if type(template) ~= "string" or template == "" then return nil end
      local nameToken, countToken = string.char(1), string.char(2)
      local pattern = template:gsub("%%s", nameToken):gsub("%%d", countToken)
      pattern = pattern:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")
      pattern = pattern:gsub(nameToken, "(.+)"):gsub(countToken, "(%%d+)")
      return pattern
    end
    -- Unanchored so a chat timestamp or color code in front of the line still matches.
    -- The (x1) line is ERR_AUCTION_COMMODITY_WON_S. Try it before the older "%s" line, which would swallow the quantity.
    local wonPatterns = {}
    local function addWon(template)
      local pattern = wonPattern(template)
      if pattern then wonPatterns[#wonPatterns + 1] = pattern end
    end
    addWon(ERR_AUCTION_COMMODITY_WON_S)
    addWon("You won an auction for %s (x%d)")
    addWon(ERR_AUCTION_WON_S)
    addWon("You won an auction for %s")
    local function auctionError(message)
      return message == ERR_NOT_ENOUGH_MONEY
        or message == ERR_AUCTION_BID_OWN
        or message == ERR_AUCTION_HIGHER_BID
        or message == ERR_ITEM_NOT_FOUND
        or message == ERR_AUCTION_BID_INCREMENT
    end
    local function remember(line)
      line = tostring(line or ""):gsub("|", "/"):gsub("%%", "pct")
      if #line > 180 then line = line:sub(1, 180) end
      slot.debug = slot.debug or {}
      slot.debug[#slot.debug + 1] = line
      while #slot.debug > 6 do table.remove(slot.debug, 1) end
    end
    local function visible(text)
      text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
      text = text:gsub("|H.-|h%[(.-)%]|h", "[%1]"):gsub("|H.-|h", ""):gsub("|h", "")
      return text
    end
    local function consider(origin, message)
      if type(message) ~= "string" then return end
      local shown = visible(message)
      local lower = shown:lower()
      if not lower:find("auction", 1, true) and not lower:find("won", 1, true) then return end
      local body, stackText
      for i = 1, #wonPatterns do
        body, stackText = shown:match(wonPatterns[i])
        if body then break end
      end
      if not body then
        remember(origin .. " | no match | " .. shown)
        return
      end
      local itemId = tonumber(message:match("item:(%d+)")) or tonumber(body:match("item:(%d+)"))
      local named = body:gsub("%s*%(x%d+%)%s*$", ""):gsub("[%[%]]", "")
      named = named:match("^%s*(.-)%s*$")
      local suffixCount = tonumber(body:match("%(x(%d+)%)%s*$"))
      if not itemId and named and slot.names then itemId = slot.names[named] end
      if not itemId then
        remember(origin .. " | unmatched name '" .. (named or "") .. "' | " .. shown)
        return
      end
      if not wanted(itemId) then
        remember(origin .. " | id " .. itemId .. " is not on this list")
        return
      end
      local now = GetTime()
      local count = tonumber(stackText) or suffixCount or takePending(itemId, "bid") or takePending(itemId, "commodity") or 1
      if slot.lastCount and slot.lastCount.id == itemId and now - slot.lastCount.time < 2 then
        remember(origin .. " | already counted " .. (named or itemId))
        return
      end
      slot.lastCount = { id = itemId, time = now }
      commit(itemId, count)
      remember(origin .. " | counted " .. (named or itemId) .. " +" .. count)
    end
    local chatEvents = {
      "CHAT_MSG_SYSTEM",
      "CHAT_MSG_MONEY",
      "CHAT_MSG_LOOT",
      "CHAT_MSG_SAY",
      "CHAT_MSG_YELL",
      "CHAT_MSG_WHISPER",
      "CHAT_MSG_PARTY",
      "CHAT_MSG_PARTY_LEADER",
      "CHAT_MSG_RAID",
      "CHAT_MSG_RAID_LEADER",
      "CHAT_MSG_RAID_WARNING",
      "CHAT_MSG_GUILD",
      "CHAT_MSG_CHANNEL",
      "CHAT_MSG_EMOTE",
      "UI_INFO_MESSAGE",
      "UI_ERROR_MESSAGE",
    }
    for i = 1, #chatEvents do
      frame:RegisterEvent(chatEvents[i])
    end
    if C_AuctionHouse then
      frame:RegisterEvent("COMMODITY_PURCHASE_SUCCEEDED")
    end
    frame:SetScript("OnEvent", function(_, event, a, b)
      if event == "COMMODITY_PURCHASE_SUCCEEDED" then
        local itemId = tonumber(a)
        local count = tonumber(b)
        if not itemId then
          itemId, count = takeOldest()
        else
          count = takePending(itemId, "commodity") or count or 1
        end
        if not itemId then
          remember("COMMODITY_PURCHASE_SUCCEEDED | no item on the event and nothing was waiting")
          return
        end
        if not wanted(itemId) then
          remember("COMMODITY_PURCHASE_SUCCEEDED | id " .. itemId .. " is not on this list")
          return
        end
        local now = GetTime()
        if slot.lastCount and slot.lastCount.id == itemId and now - slot.lastCount.time < 2 then
          remember("COMMODITY_PURCHASE_SUCCEEDED | already counted " .. itemId)
          return
        end
        slot.lastCount = { id = itemId, time = now }
        commit(itemId, count or 1)
        local name = tostring(itemId)
        if slot.names then
          for itemName, id in pairs(slot.names) do
            if id == itemId then name = itemName end
          end
        end
        remember("COMMODITY_PURCHASE_SUCCEEDED | counted " .. name .. " +" .. tostring(count or 1))
        return
      end
      if event == "UI_ERROR_MESSAGE" or event == "UI_INFO_MESSAGE" then
        local message = type(b) == "string" and b or a
        if event == "UI_ERROR_MESSAGE" then
          local newest = slot.pending[#slot.pending]
          if type(message) == "string" and newest and auctionError(message) and GetTime() - newest.time < 2 then
            table.remove(slot.pending)
          end
        end
        consider(event, message)
        return
      end
      if type(a) == "string" then
        consider(event, a)
      elseif type(b) == "string" then
        consider(event, b)
      end
    end)
    if not slot.debugHooked and type(hooksecurefunc) == "function" then
      slot.debugHooked = true
      local function watch(object, origin)
        if object and type(object.AddMessage) == "function" then
          hooksecurefunc(object, "AddMessage", function(_, text)
            consider(origin, text)
          end)
        end
      end
      watch(DEFAULT_CHAT_FRAME, "ChatFrame")
      watch(ChatFrame1, "ChatFrame1")
      watch(UIErrorsFrame, "ErrorsFrame")
    end
    slot.hooked = slot.hooked or {}
    if C_AuctionHouse and type(hooksecurefunc) == "function" then
      local function hookPurchase(key)
        if slot.hooked[key] or type(C_AuctionHouse[key]) ~= "function" then return end
        slot.hooked[key] = true
        hooksecurefunc(C_AuctionHouse, key, function(first, second)
          local itemId = tonumber(first)
          local quantity = tonumber(second) or 1
          remember(key .. " | " .. tostring(first) .. " x" .. tostring(second))
          if itemId then push(itemId, quantity, "commodity") end
        end)
      end
      hookPurchase("StartCommoditiesPurchase")
      hookPurchase("ConfirmCommoditiesPurchase")
      if type(pairs) == "function" then
        for key, value in pairs(C_AuctionHouse) do
          if type(key) == "string" and type(value) == "function" and not key:find("Cancel") and (key:find("Purchase") or key:find("Buy")) then
            hookPurchase(key)
          end
        end
      end
    end
    slot.debug = {}
    local hooked = {}
    for key in pairs(slot.hooked) do
      hooked[#hooked + 1] = key
    end
    table.sort(hooked)
    remember("purchase hooks: " .. (#hooked > 0 and table.concat(hooked, ", ") or "none"))
  end
  aura_env.saved = aura_env.saved or {}
  slot.bought = slot.bought or {}
  local function absorb(from)
    if type(from) ~= "table" then return end
    for id, count in pairs(from) do
      local itemId = tonumber(id) or id
      local n = tonumber(count) or 0
      if type(itemId) == "number" and n > (slot.bought[itemId] or 0) then
        slot.bought[itemId] = n
      end
    end
  end
  if not slot.seeded then
    absorb(slot.saved and slot.saved.bought)
    absorb(aura_env.saved.bought)
    slot.seeded = true
  end
  aura_env.saved.bought = slot.bought
  local wanted = {}
  local names = {}
  for i = 1, #items do
    wanted[items[i].id] = true
    names[items[i].name] = items[i].id
  end
  slot.saved = aura_env.saved
  slot.wanted = wanted
  slot.names = names
  local bought = slot.bought
  -- The global GetItemCount wrapper calls a missing API. Ask C_Item directly, then the container APIs.
  local function bagTotals()
    local totals = {}
    if C_Item and type(C_Item.GetItemCount) == "function" then
      local sample = C_Item.GetItemCount(items[1].id, false)
      if type(sample) == "number" then
        totals[items[1].id] = sample
        for i = 2, #items do
          local id = items[i].id
          totals[id] = C_Item.GetItemCount(id, false) or 0
        end
        return totals, true
      end
    end
    local slotsOf, infoOf
    if C_Container and type(C_Container.GetContainerNumSlots) == "function" and type(C_Container.GetContainerItemInfo) == "function" then
      slotsOf = C_Container.GetContainerNumSlots
      infoOf = C_Container.GetContainerItemInfo
    elseif type(GetContainerNumSlots) == "function" and type(GetContainerItemInfo) == "function" then
      slotsOf = GetContainerNumSlots
      infoOf = GetContainerItemInfo
    else
      return totals, false
    end
    for bag = 0, 4 do
      local slots = slotsOf(bag) or 0
      for slotIndex = 1, slots do
        local first, count, _, _, _, _, link, _, _, itemId = infoOf(bag, slotIndex)
        local id
        if type(first) == "table" then
          id = tonumber(first.itemID)
          count = first.stackCount
          if not id and type(first.hyperlink) == "string" then
            id = tonumber(first.hyperlink:match("item:(%d+)"))
          end
        elseif type(link) == "string" then
          id = tonumber(link:match("item:(%d+)"))
        elseif type(itemId) == "number" then
          id = itemId
        end
        id = tonumber(id)
        if id then
          totals[id] = (totals[id] or 0) + (tonumber(count) or 1)
        end
      end
    end
    return totals, true
  end
  local inBags, scanned = bagTotals()
  if scanned then
    slot.seenBags = slot.seenBags or {}
    for i = 1, #items do
      local id = items[i].id
      local bagsNow = inBags[id] or 0
      local previous = slot.seenBags[id]
      if previous == nil then
        slot.seenBags[id] = bagsNow
      else
        local gained = bagsNow - previous
        local held = bought[id] or 0
        if gained > 0 and held > 0 then
          local moved = gained
          if moved > held then moved = held end
          bought[id] = held - moved
          local line = "bags " .. items[i].name .. " +" .. gained .. ", auction -" .. moved
          line = line:gsub("|", "/"):gsub("%%", "pct")
          slot.debug = slot.debug or {}
          slot.debug[#slot.debug + 1] = line
          while #slot.debug > 6 do table.remove(slot.debug, 1) end
        end
        slot.seenBags[id] = bagsNow
      end
    end
  end
${guideSource(profession, steps)}
  refreshGuide()
  local shown = {}
  for i = 1, #items do
    local row = items[i]
    local need = row.need
    if slot.adjustShopping then
      need = 0
      if type(slot.adjustedNeed) == "table" and slot.adjustedNeed[row.id] then
        need = slot.adjustedNeed[row.id]
      end
    end
    if need > 0 then
      local bags = inBags[row.id] or 0
      local fromAh = bought[row.id] or 0
      local left = need - bags
      if left < 0 then left = 0 end
      shown[#shown + 1] = { name = row.name, source = row.source, left = left, fromAh = fromAh, bags = bags, icon = row.icon, quality = tonumber(row.quality) or 1, copper = tonumber(row.copper) or 0 }
    end
  end
  if slot.copyButton then slot.copyButton:Hide() end
  if slot.panel and slot.panel.layoutRevision ~= 9 then
    slot.panel:Hide()
    slot.panel = nil
  end
  local panel = slot.panel
  if not panel then
    panel = CreateFrame("Frame", nil, UIParent)
    panel.layoutRevision = 9
    panel:SetFrameStrata("HIGH")
    panel.bg = panel:CreateTexture(nil, "BACKGROUND")
    panel.bg:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
    panel.bg:SetPoint("TOPLEFT", 1, -1)
    panel.bg:SetPoint("BOTTOMRIGHT", -1, 1)
    panel.bg:SetVertexColor(0.090, 0.090, 0.090, 0.78)
    panel.edges = {}
    for i = 1, 4 do
      local edge = panel:CreateTexture(nil, "BORDER")
      edge:SetTexture("Interface\\\\Buttons\\\\WHITE8X8")
      edge:SetVertexColor(0.251, 0.251, 0.251, 1)
      panel.edges[i] = edge
    end
    local top, right, bottom, left = panel.edges[1], panel.edges[2], panel.edges[3], panel.edges[4]
    top:SetPoint("TOPLEFT")
    top:SetPoint("TOPRIGHT")
    top:SetHeight(1)
    bottom:SetPoint("BOTTOMLEFT")
    bottom:SetPoint("BOTTOMRIGHT")
    bottom:SetHeight(1)
    left:SetPoint("TOPLEFT")
    left:SetPoint("BOTTOMLEFT")
    left:SetWidth(1)
    right:SetPoint("TOPRIGHT")
    right:SetPoint("BOTTOMRIGHT")
    right:SetWidth(1)
    local function applyFont(text, size)
      text:SetFontObject(GameFontHighlight)
      local font, _, flags = text:GetFont()
      if font then text:SetFont(font, size, flags or "OUTLINE") end
    end
    local function makeText(size, justify)
      local text = panel:CreateFontString(nil, "OVERLAY")
      applyFont(text, size)
      text:SetShadowColor(0, 0, 0, 0.85)
      text:SetShadowOffset(1, -1)
      text:SetJustifyH(justify)
      text:SetJustifyV("MIDDLE")
      text:SetWordWrap(false)
      return text
    end
    panel.applyFont = applyFont
    panel.makeText = makeText
    panel.title = makeText(14, "LEFT")
    panel.headerName = makeText(12, "LEFT")
    panel.headerSource = makeText(12, "LEFT")
    panel.headerNeed = makeText(12, "RIGHT")
    panel.headerAh = makeText(12, "RIGHT")
    panel.headerBags = makeText(12, "RIGHT")
    panel.headerCost = makeText(12, "RIGHT")
    panel.totalLabel = makeText(13, "LEFT")
    panel.totalValue = makeText(13, "RIGHT")
    panel.measure = makeText(13, "LEFT")
    panel.measure:SetAlpha(0)
    local toggle = CreateFrame("Button", nil, panel)
    toggle:SetSize(22, 22)
    toggle:RegisterForClicks("LeftButtonUp")
    toggle.label = toggle:CreateFontString(nil, "OVERLAY")
    applyFont(toggle.label, 20)
    toggle.label:SetAllPoints()
    toggle.label:SetJustifyH("CENTER")
    toggle.label:SetJustifyV("MIDDLE")
    toggle.label:SetTextColor(0.890, 0.690, 0.337)
    toggle.label:SetShadowColor(0, 0, 0, 0.85)
    toggle.label:SetShadowOffset(1, -1)
    toggle:SetScript("OnClick", function()
      slot.minimized = not slot.minimized
      if type(slot.saved) == "table" then
        slot.saved.panelMinimized = slot.minimized and true or false
      end
    end)
    toggle:SetScript("OnEnter", function(self)
      self.label:SetTextColor(1, 0.860, 0.550)
    end)
    toggle:SetScript("OnLeave", function(self)
      self.label:SetTextColor(0.890, 0.690, 0.337)
    end)
    panel.toggle = toggle
    panel.rows = {}
    slot.panel = panel
  end
  panel:SetParent(UIParent)
  panel:Show()
  slot.seen = GetTime()
  panel:SetScript("OnUpdate", slot.watch)
  if not panel.wowcraftDragReady then
    panel.wowcraftDragReady = true
    panel:SetMovable(true)
    panel:EnableMouse(true)
    panel:RegisterForDrag("LeftButton")
    panel:SetClampedToScreen(true)
    panel:SetScript("OnDragStart", function(self)
      self.wowcraftDragging = true
      self:StartMoving()
    end)
    panel:SetScript("OnDragStop", function(self)
      self:StopMovingOrSizing()
      self.wowcraftDragging = false
      local left, top = self:GetLeft(), self:GetTop()
      if left and top then
        slot.userLeft = left
        slot.userTop = top
        if type(slot.saved) == "table" then
          slot.saved.panelLeft = left
          slot.saved.panelTop = top
        end
      end
    end)
  end
  if slot.userLeft == nil and type(aura_env.saved.panelLeft) == "number" and type(aura_env.saved.panelTop) == "number" then
    slot.userLeft = aura_env.saved.panelLeft
    slot.userTop = aura_env.saved.panelTop
  end
  if slot.minimized == nil then
    slot.minimized = aura_env.saved.panelMinimized and true or false
  end
  if slot.userLeft and slot.userTop then
    aura_env.saved.panelLeft = slot.userLeft
    aura_env.saved.panelTop = slot.userTop
  end
  aura_env.saved.panelMinimized = slot.minimized and true or false
  local function textWidth(value, size)
    panel.applyFont(panel.measure, size)
    panel.measure:SetText(tostring(value or ""))
    return panel.measure:GetStringWidth() or 0
  end
  local function moneyPlain(copper)
    copper = math.floor((tonumber(copper) or 0) + 0.5)
    if copper < 0 then copper = 0 end
    local gold = math.floor(copper / 10000)
    local silver = math.floor((copper % 10000) / 100)
    local coppers = copper % 100
    local parts = ""
    if gold > 0 then parts = gold .. "g" end
    if silver > 0 or gold > 0 then
      if parts ~= "" then parts = parts .. " " end
      parts = parts .. silver .. "s"
    end
    if parts ~= "" then parts = parts .. " " end
    return parts .. coppers .. "c"
  end
  local function moneyText(copper)
    copper = math.floor((tonumber(copper) or 0) + 0.5)
    if copper < 0 then copper = 0 end
    local gold = math.floor(copper / 10000)
    local silver = math.floor((copper % 10000) / 100)
    local coppers = copper % 100
    local parts = ""
    if gold > 0 then parts = "|cffffd100" .. gold .. "g|r" end
    if silver > 0 or gold > 0 then
      if parts ~= "" then parts = parts .. " " end
      parts = parts .. "|cffd1d5db" .. silver .. "s|r"
    end
    if parts ~= "" then parts = parts .. " " end
    return parts .. "|cfffb923c" .. coppers .. "c|r"
  end
  local nameWidth = textWidth(${luaString(title)}, 14)
  for i = 1, #shown do
    local measured = textWidth(shown[i].name, 13)
    if measured > nameWidth then nameWidth = measured end
  end
  nameWidth = nameWidth + 28
  if nameWidth < 120 then nameWidth = 120 end
  nameWidth = math.floor(nameWidth / 2)
  local columnWidth = textWidth("Need", 12)
  local mailHeader = textWidth("Mail", 12)
  local bagsHeader = textWidth("Bags", 12)
  if mailHeader > columnWidth then columnWidth = mailHeader end
  if bagsHeader > columnWidth then columnWidth = bagsHeader end
  local totalCopper = 0
  for i = 1, #shown do
    local count = shown[i]
    local lineCopper = (tonumber(count.copper) or 0) * (tonumber(count.left) or 0)
    count.lineCopper = lineCopper
    totalCopper = totalCopper + lineCopper
    local needWidth = textWidth(tostring(count.left), 13)
    local ahWidth = textWidth(tostring(count.fromAh), 13)
    local bagWidth = textWidth(tostring(count.bags), 13)
    if needWidth > columnWidth then columnWidth = needWidth end
    if ahWidth > columnWidth then columnWidth = ahWidth end
    if bagWidth > columnWidth then columnWidth = bagWidth end
  end
  columnWidth = columnWidth + 2
  local sourceWidth = textWidth("Vendor", 13)
  local sourceHeader = textWidth("Source", 12)
  if sourceHeader > sourceWidth then sourceWidth = sourceHeader end
  sourceWidth = sourceWidth + 2
  local costWidth = textWidth("Cost", 12)
  local totalPlain = moneyPlain(totalCopper)
  local totalMeasure = textWidth(totalPlain, 13)
  if totalMeasure > costWidth then costWidth = totalMeasure end
  for i = 1, #shown do
    local lineMeasure = textWidth(moneyPlain(shown[i].lineCopper), 13)
    if lineMeasure > costWidth then costWidth = lineMeasure end
  end
  costWidth = costWidth + 2
  local padX, padY, rowHeight, columnGap = 12, 10, 20, 12
  local width = padX + nameWidth + sourceWidth + columnWidth * 3 + costWidth + columnGap * 5 + padX
  local titleNeed = textWidth(${luaString(title)}, 14) + padX * 2 + 28
  if width < titleNeed then width = titleNeed end
  local height = padY + 18 + padY
  if not slot.minimized then
    height = padY + 18 + 6 + rowHeight + 6 + (#shown * rowHeight) + padY
    if #shown > 0 then height = height + 4 + rowHeight end
  end
  height = height + 14
  panel:SetSize(width, height)
  if not panel.watermark and panel.makeText then
    panel.watermark = panel.makeText(10, "RIGHT")
  end
  if panel.watermark then
    panel.watermark:ClearAllPoints()
    panel.watermark:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -8, 4)
    panel.watermark:SetSize(110, 12)
    if panel.applyFont then panel.applyFont(panel.watermark, 10) end
    panel.watermark:SetText("WoWCraft.io")
    panel.watermark:SetTextColor(0.890, 0.690, 0.337)
    panel.watermark:SetAlpha(0.45)
    panel.watermark:Show()
  end
  local function tuckProfessionTabs(host)
    if slot.released then return end
    if type(host) ~= "table" or type(host.IsShown) ~= "function" or not host:IsShown() then return end
    local bounds = host
    if type(host.NineSlice) == "table" and type(host.NineSlice.GetLeft) == "function" and host.NineSlice:GetLeft() then
      bounds = host.NineSlice
    end
    local hostLeft, hostRight = bounds:GetLeft(), bounds:GetRight()
    if not hostLeft or not hostRight then return end
    local names = {
      "ProfessionsOverviewTab",
      "Professions1Tab",
      "Professions2Tab",
      "Professions3Tab",
      "Professions4Tab",
      "Professions5Tab",
    }
    local tabs = {}
    for i = 1, #names do
      local tab = host[names[i]]
      if type(tab) == "table" and type(tab.GetPoint) == "function" and type(tab.SetPoint) == "function" then
        tabs[#tabs + 1] = tab
      end
    end
    for i = 1, #tabs do
      local tab = tabs[i]
      local point, relativeTo, relativePoint, x, y = tab:GetPoint(1)
      if point then
        if tab.wowcraftBaseY == nil then
          tab.wowcraftBaseY = y or 0
          tab.wowcraftBaseX = x or 0
          tab.wowcraftBasePoint = point
          tab.wowcraftBaseRelative = relativeTo
          tab.wowcraftBaseRelativePoint = relativePoint
        end
        local anchoredToTab = false
        for j = 1, #tabs do
          if relativeTo == tabs[j] then
            anchoredToTab = true
          end
        end
        local shift = 0
        if type(tab.GetLeft) == "function" then
          local tabLeft, tabRight = tab:GetLeft(), tab:GetRight()
          if tabLeft and tabRight then
            if tabLeft < hostLeft - 1 then
              shift = hostLeft - tabLeft
            elseif tabRight > hostRight + 1 then
              shift = hostRight - tabRight
            end
          end
        end
        local targetY = tab.wowcraftBaseY
        if not anchoredToTab then
          targetY = targetY - 24
        end
        if shift ~= 0 or math.abs((y or 0) - targetY) > 0.5 then
          tab.wowcraftMoving = true
          tab:ClearAllPoints()
          tab:SetPoint(point, relativeTo or host, relativePoint or point, (x or 0) + shift, targetY)
          tab.wowcraftMoving = false
        end
        if not tab.wowcraftHooked and type(hooksecurefunc) == "function" then
          tab.wowcraftHooked = true
          hooksecurefunc(tab, "SetPoint", function(self)
            if self.wowcraftMoving then return end
            tuckProfessionTabs(host)
          end)
        end
        if type(tab.SetFrameStrata) == "function" then
          tab:SetFrameStrata("DIALOG")
        end
        if type(tab.SetFrameLevel) == "function" then
          local level = 40
          if type(host.GetFrameLevel) == "function" then
            level = (host:GetFrameLevel() or 1) + 30
          end
          tab:SetFrameLevel(level)
        end
      end
    end
  end
  tuckProfessionTabs(ProfessionsFrame)
  local craft = ProfessionsFrame
  if not (type(craft) == "table" and type(craft.IsShown) == "function" and craft:IsShown()) then
    craft = TradeSkillFrame
  end
  local attached = type(craft) == "table" and type(craft.IsShown) == "function" and craft:IsShown()
  local helper = slot.guide
  local helperReady = type(helper) == "table" and type(helper.IsShown) == "function" and helper:IsShown() and not helper.wowcraftDragging
  if panel.wowcraftDragging then
  elseif slot.userLeft and slot.userTop then
    panel:ClearAllPoints()
    panel:SetFrameStrata("HIGH")
    panel:SetFrameLevel(100)
    panel:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", slot.userLeft, slot.userTop)
  elseif helperReady then
    panel:ClearAllPoints()
    if type(helper.GetFrameStrata) == "function" then
      panel:SetFrameStrata(helper:GetFrameStrata() or "HIGH")
    end
    if type(helper.GetFrameLevel) == "function" then
      panel:SetFrameLevel((helper:GetFrameLevel() or 1) + 1)
    end
    local gap = 8
    local screenWidth = type(GetScreenWidth) == "function" and GetScreenWidth() or 0
    local helperRight = type(helper.GetRight) == "function" and helper:GetRight()
    local placeRight = helper.wowcraftDock ~= "left" or helper.userLeft ~= nil
    if placeRight and helperRight and screenWidth - helperRight < width + gap then
      placeRight = false
    end
    if placeRight then
      panel:SetPoint("TOPLEFT", helper, "TOPRIGHT", gap, 0)
    else
      panel:SetPoint("TOPRIGHT", helper, "TOPLEFT", -gap, 0)
    end
  elseif attached and type(craft.GetRight) == "function" and craft:GetRight() and craft:GetTop() then
    panel:ClearAllPoints()
    local host = craft
    local border = craft.NineSlice
    if type(border) == "table" and type(border.GetRight) == "function" and border:GetRight() then
      craft = border
    end
    if type(host.GetFrameStrata) == "function" then
      panel:SetFrameStrata(host:GetFrameStrata() or "HIGH")
    end
    if type(host.GetFrameLevel) == "function" then
      panel:SetFrameLevel((host:GetFrameLevel() or 1) + 5)
    end
    local gap = 8
    local screenWidth = type(GetScreenWidth) == "function" and GetScreenWidth() or 0
    if screenWidth - craft:GetRight() >= width + gap then
      panel:SetPoint("TOPLEFT", craft, "TOPRIGHT", gap, 0)
    else
      panel:SetPoint("TOPRIGHT", craft, "TOPLEFT", -gap, 0)
    end
  else
    panel:ClearAllPoints()
    panel:SetFrameStrata("HIGH")
    panel:SetFrameLevel(100)
    local region = aura_env.region
    local regionLeft = region and type(region.GetLeft) == "function" and region:GetLeft()
    local regionTop = region and type(region.GetTop) == "function" and region:GetTop()
    if regionLeft and regionTop and regionTop > 200 then
      panel:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", regionLeft, regionTop)
    else
      panel:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 16, -160)
    end
  end
  local sourceX = padX + nameWidth + columnGap
  local needX = sourceX + sourceWidth + columnGap
  local ahX = needX + columnWidth + columnGap
  local bagsX = ahX + columnWidth + columnGap
  local costX = bagsX + columnWidth + columnGap
  local function place(text, x, y, cellWidth, cellHeight)
    text:ClearAllPoints()
    text:SetSize(cellWidth, cellHeight)
    text:SetPoint("TOPLEFT", panel, "TOPLEFT", x, y)
    text:Show()
  end
  local function applyIcon(texture, icon)
    if type(icon) == "string" and icon ~= "" then
      texture:SetTexture("Interface\\\\Icons\\\\" .. icon)
      texture:SetTexCoord(0.08, 0.92, 0.08, 0.92)
      texture:Show()
    else
      texture:SetTexture(nil)
      texture:Hide()
    end
  end
  local function hideRow(extra)
    if extra.icon then extra.icon:Hide() end
    extra.name:Hide()
    extra.source:Hide()
    extra.need:Hide()
    extra.ah:Hide()
    extra.bags:Hide()
    if extra.cost then extra.cost:Hide() end
  end
  local y = -padY
  place(panel.title, padX, y, width - padX * 2 - 28, 18)
  panel.title:SetText(${luaString(title)})
  panel.title:SetTextColor(0.890, 0.690, 0.337)
  panel.toggle:ClearAllPoints()
  panel.toggle:SetSize(22, 22)
  panel.toggle:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -8, -(padY - 2))
  panel.toggle:Show()
  if slot.minimized then
    panel.toggle.label:SetText("+")
    panel.headerName:Hide()
    panel.headerSource:Hide()
    panel.headerNeed:Hide()
    panel.headerAh:Hide()
    panel.headerBags:Hide()
    panel.headerCost:Hide()
    panel.totalLabel:Hide()
    panel.totalValue:Hide()
    for i = 1, #panel.rows do
      hideRow(panel.rows[i])
    end
    refreshGuide()
    return ""
  end
  panel.toggle.label:SetText("-")
  y = y - 24
  place(panel.headerName, padX + 20, y, nameWidth - 20, rowHeight)
  panel.headerName:SetText("Material")
  panel.headerName:SetTextColor(0.64, 0.64, 0.64)
  place(panel.headerSource, sourceX, y, sourceWidth, rowHeight)
  panel.headerSource:SetText("Source")
  panel.headerSource:SetTextColor(0.64, 0.64, 0.64)
  place(panel.headerNeed, needX, y, columnWidth, rowHeight)
  panel.headerNeed:SetText("Need")
  panel.headerNeed:SetTextColor(1, 0.333, 0.333)
  place(panel.headerAh, ahX, y, columnWidth, rowHeight)
  panel.headerAh:SetText("Mail")
  panel.headerAh:SetTextColor(1, 0.820, 0)
  place(panel.headerBags, bagsX, y, columnWidth, rowHeight)
  panel.headerBags:SetText("Bags")
  panel.headerBags:SetTextColor(0.333, 1, 0.333)
  place(panel.headerCost, costX, y, costWidth, rowHeight)
  panel.headerCost:SetText("Cost")
  panel.headerCost:SetTextColor(0.890, 0.690, 0.337)
  y = y - rowHeight - 4
  local function qualityColor(quality)
    quality = tonumber(quality) or 1
    if type(GetItemQualityColor) == "function" then
      local r, g, b = GetItemQualityColor(quality)
      if type(r) == "number" and type(g) == "number" and type(b) == "number" then
        return r, g, b
      end
    end
    if type(ITEM_QUALITY_COLORS) == "table" then
      local color = ITEM_QUALITY_COLORS[quality]
      if type(color) == "table" and type(color.r) == "number" then
        return color.r, color.g, color.b
      end
    end
    local fallback = {
      [0] = { 0.62, 0.62, 0.62 },
      [1] = { 1, 1, 1 },
      [2] = { 0.12, 1, 0 },
      [3] = { 0, 0.44, 0.87 },
      [4] = { 0.64, 0.21, 0.93 },
      [5] = { 1, 0.5, 0 },
      [6] = { 0.9, 0.8, 0.5 },
      [7] = { 0, 0.8, 1 },
    }
    local color = fallback[quality] or fallback[1]
    return color[1], color[2], color[3]
  end
  for i = 1, #shown do
    local row = panel.rows[i]
    if not row then
      row = {
        icon = panel:CreateTexture(nil, "ARTWORK"),
        name = panel.makeText(13, "LEFT"),
        source = panel.makeText(13, "LEFT"),
        need = panel.makeText(13, "RIGHT"),
        ah = panel.makeText(13, "RIGHT"),
        bags = panel.makeText(13, "RIGHT"),
        cost = panel.makeText(13, "RIGHT"),
      }
      row.icon:SetSize(16, 16)
      panel.rows[i] = row
    end
    local data = shown[i]
    local count = shown[i]
    row.icon:ClearAllPoints()
    row.icon:SetPoint("TOPLEFT", panel, "TOPLEFT", padX, y - 2)
    applyIcon(row.icon, data.icon)
    place(row.name, padX + 20, y, nameWidth - 20, rowHeight)
    row.name:SetText(tostring(data.name))
    local nameR, nameG, nameB = qualityColor(data.quality)
    row.name:SetTextColor(nameR, nameG, nameB)
    place(row.source, sourceX, y, sourceWidth, rowHeight)
    if data.source == "vendor" then
      row.source:SetText("Vendor")
      row.source:SetTextColor(0.431, 0.906, 0.718)
    elseif data.source == "auction" then
      row.source:SetText("AH")
      row.source:SetTextColor(0.490, 0.827, 0.988)
    else
      row.source:SetText("")
    end
    place(row.need, needX, y, columnWidth, rowHeight)
    row.need:SetText(tostring(count.left))
    row.need:SetTextColor(1, 0.333, 0.333)
    place(row.ah, ahX, y, columnWidth, rowHeight)
    row.ah:SetText(tostring(count.fromAh))
    row.ah:SetTextColor(1, 0.820, 0)
    place(row.bags, bagsX, y, columnWidth, rowHeight)
    row.bags:SetText(tostring(count.bags))
    row.bags:SetTextColor(0.333, 1, 0.333)
    place(row.cost, costX, y, costWidth, rowHeight)
    row.cost:SetText(moneyText(count.lineCopper))
    row.cost:SetTextColor(1, 1, 1)
    y = y - rowHeight
  end
  if #shown > 0 then
    y = y - 4
    place(panel.totalLabel, padX, y, nameWidth, rowHeight)
    panel.totalLabel:SetText("Total")
    panel.totalLabel:SetTextColor(0.890, 0.690, 0.337)
    place(panel.totalValue, costX, y, costWidth, rowHeight)
    panel.totalValue:SetText(moneyText(totalCopper))
    panel.totalValue:SetTextColor(1, 1, 1)
  else
    panel.totalLabel:Hide()
    panel.totalValue:Hide()
  end
  for i = #shown + 1, #panel.rows do
    hideRow(panel.rows[i])
  end
  refreshGuide()
  return ""
end`;
}

function auraProgram(title: string, profession: string, steps: GuideStep[], items: ShoppingListItem[]): string {
  const rows = shoppingRows(items);
  const guide = steps.filter((step) => plainText(step.name));
  if (!rows.length && !guide.length) return '';
  const heading = plainText(title) || 'WoWCraft';
  return `
local aura = {
  id = ${luaString(heading)},
  uid = ${luaString(weakAuraUid(heading))},
  regionType = "text",
  internalVersion = ${INTERNAL_VERSION},
  desc = "Shopping list and leveling guide from WoWCraft. The guide is its own frame and opens with the professions window.",
  triggers = {
    {
      trigger = {
        type = "unit",
        event = "Conditions",
        unit = "player",
        use_unit = true,
        use_alwaystrue = true,
        debuffType = "HELPFUL",
      },
      untrigger = {},
    },
    activeTriggerMode = -10,
    disjunctive = "all",
  },
  load = {
    size = { multi = {} },
    class = { multi = {} },
    spec = { multi = {} },
    talent = { multi = {} },
  },
  actions = {
    init = {
      do_custom = true,
      custom = ${luaString(`WoWCraftShoppingHooks = WoWCraftShoppingHooks or {}
if not WoWCraftShoppingHooks.bootId then
  WoWCraftShoppingHooks.bootId = {}
end
WoWCraftShoppingHooks.seen = WoWCraftShoppingHooks.seen or {}
WoWCraftShoppingHooks.choices = WoWCraftShoppingHooks.choices or {}
local id = aura_env.id
if WoWCraftShoppingHooks.seen[id] == WoWCraftShoppingHooks.bootId then
  WoWCraftShoppingHooks.choices[id] = nil
  if type(aura_env.saved) == "table" then
    aura_env.saved.guideChoice = nil
    aura_env.saved.guideChoiceStamp = nil
  end
  local slot = WoWCraftShoppingHooks.auras and WoWCraftShoppingHooks.auras[id]
  if type(slot) == "table" then
    slot.guideChoice = nil
  end
end
WoWCraftShoppingHooks.seen[id] = WoWCraftShoppingHooks.bootId`)},
    },
    start = {},
    finish = {
      do_custom = true,
      custom = ${luaString(`local hooks = WoWCraftShoppingHooks
local slot = hooks and hooks.auras and aura_env and hooks.auras[aura_env.id]
if slot and slot.cleanup then slot.cleanup() end`)},
    },
  },
  animation = {
    start = { type = "none", duration_type = "seconds" },
    main = { type = "none", duration_type = "seconds" },
    finish = { type = "none", duration_type = "seconds" },
  },
  conditions = {},
  authorOptions = {},
  information = {},
  config = {},
  displayText = "%c",
  customText = ${luaString(customTextSource(heading, rows, profession, guide))},
  customTextUpdate = "update",
  customTextUpdateThrottle = 0.25,
  font = "Friz Quadrata TT",
  fontSize = 14,
  outline = "OUTLINE",
  color = { 1, 1, 1, 1 },
  justify = "LEFT",
  selfPoint = "TOPLEFT",
  anchorPoint = "TOPLEFT",
  anchorFrameType = "SCREEN",
  xOffset = 16,
  yOffset = -160,
  frameStrata = 4,
  automaticWidth = "Auto",
  wordWrap = "WordWrap",
  shadowColor = { 0, 0, 0, 1 },
  shadowXOffset = 1,
  shadowYOffset = -1,
  alpha = 1,
}
customResult = aura.customText
local transmit = {
  m = "d",
  d = aura,
  v = ${TRANSMIT_VERSION},
  s = "WoWCraft",
}
local serialized = LibSerialize:SerializeEx({ errorOnUnserializableType = false }, transmit)
local compressed = LibDeflate:CompressDeflate(serialized, { level = 9 })
result = "!WA:2!" .. LibDeflate:EncodeForPrint(compressed)
`;
}

let vmReady: Promise<unknown> | null = null;

function run(state: unknown, code: string) {
  const status = lauxlib.luaL_dostring(state, to_luastring(code));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tolstring(state, -1));
    throw new Error(message);
  }
}

function loadVm(): Promise<unknown> {
  if (!vmReady) {
    vmReady = Promise.resolve().then(() => {
      const state = lauxlib.luaL_newstate();
      lualib.luaL_openlibs(state);
      // Lua 5.1 calls the global unpack. Fengari is Lua 5.3, where it lives on table.
      run(state, 'unpack = table.unpack');
      run(state, 'LibDeflate = (function()\n' + libDeflateSource + '\nend)()');
      run(state, 'LibSerialize = (function()\n' + libSerializeSource + '\nend)()');
      return state;
    }).catch((error) => {
      vmReady = null;
      throw error;
    });
  }
  return vmReady;
}

/**
 * Build the shopping-list aura, then serialize it the way WeakAuras exports:
 * LibSerialize, raw DEFLATE at level 9, then the printable `!WA:2!` encoding.
 */
export async function weakAuraShoppingList(
  profession: string,
  skill: number,
  target: number,
  items: ShoppingListItem[],
  steps: GuideStep[] = [],
  realm = '',
  faction = '',
): Promise<string> {
  const title = realm || faction
    ? shoppingListTitle(profession, skill, target, realm, faction)
    : auctionatorListName(profession, skill, target);
  const program = auraProgram(title, profession, steps, items);
  if (!program) return '';
  const state = await loadVm();
  run(state, program);
  run(state, 'local parsed, loadError = load("return " .. customResult)\nif not parsed then error(loadError or "custom text failed to parse") end');
  lua.lua_getglobal(state, to_luastring('result'));
  const encoded = to_jsstring(lua.lua_tolstring(state, -1));
  if (!encoded.startsWith('!WA:2!')) throw new Error('WeakAura export was empty');
  return encoded;
}
