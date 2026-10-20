import * as fengariNamespace from 'fengari-web';
import { auctionatorListName, shoppingQuantity, type ShoppingListItem } from '../shoppingList';
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

type ShoppingRow = { id: number; name: string; need: number; source: 'vendor' | 'auction' | '' };

function shoppingRows(items: ShoppingListItem[]): ShoppingRow[] {
  const byId = new Map<number, ShoppingRow>();
  for (const item of items) {
    const name = plainText(item.name || '');
    if (!name || !Number.isFinite(item.itemId) || item.itemId <= 0) continue;
    const need = shoppingQuantity(item.quantity);
    const source = item.source === 'vendor' || item.source === 'auction' ? item.source : '';
    const existing = byId.get(item.itemId);
    if (existing) existing.need += need;
    else byId.set(item.itemId, { id: item.itemId, name, need, source });
  }
  return [...byId.values()];
}

/**
 * Custom text runs in WoW (Lua 5.1). Red is still missing from bags, yellow is
 * remembered auction-house buyouts, green is the current bag count.
 */
function customTextSource(title: string, rows: ShoppingRow[]): string {
  const itemLines = rows.map((row) => `    { id = ${row.id}, name = ${luaString(row.name)}, need = ${row.need}, source = ${luaString(row.source)} },`).join('\n');
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
        if id and wanted[id] then
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
  local counts = {}
  for i = 1, #items do
    local row = items[i]
    local bags = inBags[row.id] or 0
    local fromAh = bought[row.id] or 0
    local left = row.need - bags
    if left < 0 then left = 0 end
    counts[i] = { left = left, fromAh = fromAh, bags = bags }
  end
  if slot.copyButton then slot.copyButton:Hide() end
  if slot.panel and slot.panel.layoutRevision ~= 8 then
    slot.panel:Hide()
    slot.panel = nil
  end
  local panel = slot.panel
  if not panel then
    panel = CreateFrame("Frame", nil, UIParent)
    panel.layoutRevision = 8
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
  local nameWidth = textWidth(${luaString(title)}, 14)
  for i = 1, #items do
    local measured = textWidth(items[i].name, 13)
    if measured > nameWidth then nameWidth = measured end
  end
  nameWidth = nameWidth + 8
  if nameWidth < 96 then nameWidth = 96 end
  local columnWidth = textWidth("Need", 12)
  local mailHeader = textWidth("Mail", 12)
  local bagsHeader = textWidth("Bags", 12)
  if mailHeader > columnWidth then columnWidth = mailHeader end
  if bagsHeader > columnWidth then columnWidth = bagsHeader end
  for i = 1, #items do
    local count = counts[i]
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
  local padX, padY, rowHeight, columnGap = 12, 10, 16, 12
  local width = padX + nameWidth + sourceWidth + columnWidth * 3 + columnGap * 4 + padX
  local height = padY + 18 + padY
  if not slot.minimized then
    height = padY + 18 + 6 + rowHeight + 6 + (#items * rowHeight) + padY
  end
  panel:SetSize(width, height)
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
  if panel.wowcraftDragging then
  elseif slot.userLeft and slot.userTop then
    panel:ClearAllPoints()
    panel:SetFrameStrata("HIGH")
    panel:SetFrameLevel(100)
    panel:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", slot.userLeft, slot.userTop)
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
  local function place(text, x, y, cellWidth, cellHeight)
    text:ClearAllPoints()
    text:SetSize(cellWidth, cellHeight)
    text:SetPoint("TOPLEFT", panel, "TOPLEFT", x, y)
    text:Show()
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
    for i = 1, #panel.rows do
      local extra = panel.rows[i]
      extra.name:Hide()
      extra.source:Hide()
      extra.need:Hide()
      extra.ah:Hide()
      extra.bags:Hide()
    end
    return ""
  end
  panel.toggle.label:SetText("-")
  y = y - 24
  place(panel.headerName, padX, y, nameWidth, rowHeight)
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
  y = y - rowHeight - 4
  for i = 1, #items do
    local row = panel.rows[i]
    if not row then
      row = {
        name = panel.makeText(13, "LEFT"),
        source = panel.makeText(13, "LEFT"),
        need = panel.makeText(13, "RIGHT"),
        ah = panel.makeText(13, "RIGHT"),
        bags = panel.makeText(13, "RIGHT"),
      }
      panel.rows[i] = row
    end
    local data = items[i]
    local count = counts[i]
    place(row.name, padX, y, nameWidth, rowHeight)
    row.name:SetText(tostring(data.name))
    if count.left > 0 then
      row.name:SetTextColor(1, 1, 1)
    else
      row.name:SetTextColor(0.333, 1, 0.333)
    end
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
    y = y - rowHeight
  end
  for i = #items + 1, #panel.rows do
    local extra = panel.rows[i]
    extra.name:Hide()
    extra.source:Hide()
    extra.need:Hide()
    extra.ah:Hide()
    extra.bags:Hide()
  end
  return ""
end`;
}

function auraProgram(title: string, items: ShoppingListItem[]): string {
  const rows = shoppingRows(items);
  if (!rows.length) return '';
  const heading = plainText(title) || 'WoWCraft';
  return `
local aura = {
  id = ${luaString(heading)},
  uid = ${luaString(weakAuraUid(heading))},
  regionType = "text",
  internalVersion = ${INTERNAL_VERSION},
  desc = "Shopping list from WoWCraft. Red is still needed, yellow was bought from the auction house, green is in your bags.",
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
    init = {},
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
  customText = ${luaString(customTextSource(heading, rows))},
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
): Promise<string> {
  const program = auraProgram(auctionatorListName(profession, skill, target), items);
  if (!program) return '';
  const state = await loadVm();
  run(state, program);
  lua.lua_getglobal(state, to_luastring('result'));
  const encoded = to_jsstring(lua.lua_tolstring(state, -1));
  if (!encoded.startsWith('!WA:2!')) throw new Error('WeakAura export was empty');
  return encoded;
}
