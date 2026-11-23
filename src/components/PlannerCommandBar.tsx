'use client';

import { useEffect, useState, type Key, type ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { Range, getTrackBackground } from 'react-range';
import { Listbox } from '@headlessui/react';
import { skillUpChanceFloor, type SkillGapReason } from '@/lib/planner';
import { RealmName, realmRingClass } from '@/components/RealmName';
import { FactionIcon, factionRingClass, factionTextClass } from '@/components/FactionMark';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

type PriceMode = 'cost' | 'cost-vendor' | 'disenchant' | 'auction-house';
type GuideStepLike = { endSkill: number; gap?: string };

const PRICE_MODES: { id: PriceMode; label: string; title: string }[] = [
  { id: 'cost', label: 'Raw material cost', title: 'Price the route from the materials it consumes' },
  { id: 'cost-vendor', label: 'Vendor value', title: 'Subtract what a vendor pays for the crafted item' },
  { id: 'disenchant', label: 'Disenchant value', title: 'Subtract the value of disenchanting the crafted item' },
  { id: 'auction-house', label: 'Auction House', title: 'Skip crafts that sell too rarely' },
];

function accent(version: string): string {
  if (version === 'The Burning Crusade') return '#10b981';
  if (version === 'Forever') return '#1fb5f7';
  return '#eab308';
}

function selectedFill(version: string): string {
  if (version === 'The Burning Crusade') return 'bg-emerald-500 text-neutral-950';
  if (version === 'Forever') return 'bg-[#1fb5f7] text-neutral-950';
  return 'bg-yellow-400 text-neutral-950';
}

export function PlannerNavLinks({
  view,
  onView,
  className,
}: {
  view: 'route' | 'all';
  onView: (view: 'route' | 'all') => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onView('route')}
        className={view === 'route' ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'}
      >
        Guide
      </button>
      <button
        type="button"
        onClick={() => onView('all')}
        className={view === 'all' ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'}
      >
        Recipes
      </button>
      <Link href="/faq" className="text-neutral-500 hover:text-white">FAQ</Link>
      <Link href="/promo" className="text-neutral-500 hover:text-white">About</Link>
      <div className="ml-auto flex items-center gap-2">
      <a
        href="https://github.com/MalteNilsson/WoWCraft"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded border border-white/15 bg-neutral-800 px-3 py-1.5 text-white transition-colors hover:bg-neutral-700"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
        GitHub
      </a>
      <a
        href="https://discord.com/invite/KE4kEEyTJh"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded border border-[#3d4278] bg-[#2a2d52] px-3 py-1.5 text-[#c9cdf8] transition-colors hover:bg-[#343868] hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        Discord
      </a>
      </div>
    </div>
  );
}

function valueClass(version: string): string {
  if (version === 'The Burning Crusade') return 'text-emerald-400';
  if (version === 'Forever') return 'text-[#1fb5f7]';
  return 'text-yellow-300';
}

function SkillField({
  label,
  value,
  min,
  max,
  className,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  className: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commitValue = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    onCommit(Math.min(max, Math.max(min, parsed)));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.target.value.replace(/[^\d]/g, ''))}
      onBlur={(event) => {
        setFocused(false);
        commitValue(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitValue(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      className={`w-11 bg-transparent text-center text-sm font-semibold tabular-nums outline-none ${className}`}
    />
  );
}

export function PlannerCommandBar({
  version,
  versions,
  onVersion,
  realm,
  realms,
  onRealm,
  faction,
  factions,
  onFaction,
  profession,
  professions,
  onProfession,
  chartOpen,
  onToggleChart,
  skill,
  target,
  maxSkill,
  committedSkill,
  committedTarget,
  guideSkillLimit,
  steps,
  isDesktop,
  onSliderStart,
  onRangeChange,
  onRangeCommit,
  onSkillCommit,
  onTargetCommit,
  priceMode,
  onPriceMode,
  minSaleRatePercent,
  view,
  onView,
  settings,
  onClassic,
  guideTip,
  onGuideTip,
  onGuideTipLeave,
  minSkillUpChance,
}: {
  version: string;
  versions: string[];
  onVersion: (version: string) => void;
  realm: string;
  realms: string[];
  onRealm: (realm: string) => void;
  faction: string;
  factions: string[];
  onFaction: (faction: string) => void;
  profession: string;
  professions: string[];
  onProfession: (profession: string) => void;
  chartOpen: boolean;
  onToggleChart: () => void;
  skill: number;
  target: number;
  maxSkill: number;
  committedSkill: number;
  committedTarget: number;
  guideSkillLimit: number | null;
  steps: GuideStepLike[];
  isDesktop: boolean;
  onSliderStart: () => void;
  onRangeChange: (low: number, high: number) => void;
  onRangeCommit: (low: number, high: number) => void;
  onSkillCommit: (value: number) => void;
  onTargetCommit: (value: number) => void;
  priceMode: PriceMode;
  onPriceMode: (mode: PriceMode) => void;
  minSaleRatePercent: number;
  view: 'route' | 'all';
  onView: (view: 'route' | 'all') => void;
  settings: ReactNode;
  onClassic: () => void;
  guideTip: { top: number; left: number; center: boolean; kind: 'materials' | SkillGapReason; skill: number } | null;
  onGuideTip: (tip: { top: number; left: number; center: boolean; kind: 'materials' | SkillGapReason; skill: number }) => void;
  onGuideTipLeave: () => void;
  minSkillUpChance: number;
}) {
  const fill = accent(version);
  const thumb = isDesktop ? 18 : 28;
  const gaps: { from: number; to: number; kind: 'materials' | SkillGapReason }[] = [];
  let cursor = committedSkill;
  for (const step of steps) {
    if (step.gap && step.endSkill > cursor) {
      gaps.push({ from: cursor, to: step.endSkill, kind: step.gap as 'materials' | SkillGapReason });
    }
    cursor = step.endSkill;
  }
  if (guideSkillLimit != null && guideSkillLimit >= committedTarget && guideSkillLimit < maxSkill) {
    gaps.push({ from: guideSkillLimit, to: maxSkill, kind: 'materials' });
  }

  const tipText = !guideTip
    ? ''
    : guideTip.kind === 'sale-rate'
      ? `Skill ${guideTip.skill} through here has no craft at a ${minSaleRatePercent}% sale rate. Everything that raises skill in this stretch sells less often than that.`
      : guideTip.kind === 'skill-chance'
        ? `Skill ${guideTip.skill} through here has no craft with at least a ${Math.round(skillUpChanceFloor(priceMode, minSkillUpChance) * 100)}% chance to skill up.`
        : guideTip.kind === 'no-recipe'
          ? `No recipe raises skill through this stretch, starting at ${guideTip.skill}.`
          : guideTip.kind === 'bop'
            ? `Skill ${guideTip.skill} through here only has crafts learned from Bind on Pickup recipe items.`
            : guideTip.kind === 'unpriced'
              ? `No priced craft continues from skill ${guideTip.skill}. The auction data does not cover this stretch.`
              : version === 'Forever'
                ? `Not recommended past skill ${guideTip.skill}. Most players are still below level 30, so higher-level materials are not on the auction house yet and a route through this stretch cannot be priced.`
                : `Not recommended past skill ${guideTip.skill}. The auction prices do not cover a complete route through this stretch.`;

  return (
    <div className="flex flex-col gap-2">
      <Listbox value={profession} onChange={onProfession}>
        {({ open }) => (
          <div className="relative w-full">
            <Listbox.Button className={`flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-800/80 px-3 py-2.5 text-lg text-white transition-colors ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
              <span className="flex min-w-0 items-center gap-2.5">
                <img src={`/icons/${profession.toLowerCase()}.webp`} alt="" className="h-10 w-10 shrink-0" />
                <span className="truncate font-semibold">{profession}</span>
              </span>
              <Chevron open={open} />
            </Listbox.Button>
            <Listbox.Options className="absolute z-40 mt-1 w-full overflow-auto rounded-lg bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black/40 focus:outline-none">
              {professions.map((name) => (
                <Listbox.Option key={name} value={name} className={({ active }) => `cursor-pointer select-none px-2.5 py-2 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                  {({ selected }) => (
                    <span className="flex items-center gap-2.5">
                      <img src={`/icons/${name.toLowerCase()}.webp`} alt="" className="h-8 w-8 shrink-0" />
                      <span className={`truncate font-semibold ${selected ? 'text-white' : ''}`}>{name}</span>
                    </span>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </div>
        )}
      </Listbox>

      <div className="flex items-stretch gap-1.5">
        <Listbox value={realm} onChange={onRealm}>
          {({ open }) => (
            <div className="relative min-w-0 flex-1">
              <Listbox.Button className={`flex h-full w-full items-center justify-between gap-1 rounded-md border border-white/10 bg-neutral-800/80 px-3 py-2 text-sm transition-colors ${realmRingClass(realm)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                <span className="truncate font-semibold"><RealmName realm={realm} /></span>
                <Chevron open={open} />
              </Listbox.Button>
              <Listbox.Options className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-sm shadow-lg ring-1 ring-black/40 focus:outline-none">
                {realms.map((item) => (
                  <Listbox.Option key={item} value={item} className={({ active }) => `cursor-pointer select-none px-2.5 py-1.5 ${active ? 'bg-neutral-700' : ''}`}>
                    <span className="block truncate font-semibold"><RealmName realm={item} /></span>
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          )}
        </Listbox>
        <Listbox value={faction} onChange={onFaction}>
          {({ open }) => (
            <div className="relative min-w-0 flex-1">
              <Listbox.Button className={`flex h-full w-full items-center justify-between gap-1 rounded-md border border-white/10 bg-neutral-800/80 px-3 py-2 text-sm transition-colors ${factionRingClass(faction)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                <span className={`flex min-w-0 items-center gap-1.5 font-semibold ${factionTextClass(faction)}`}>
                  <FactionIcon faction={faction} className="h-5 w-5" />
                  <span className="truncate">{faction}</span>
                </span>
                <Chevron open={open} />
              </Listbox.Button>
              <Listbox.Options className="absolute z-40 mt-1 w-full min-w-[9rem] overflow-auto rounded-md bg-neutral-800 py-1 text-sm shadow-lg ring-1 ring-black/40 focus:outline-none">
                {factions.map((item) => (
                  <Listbox.Option key={item} value={item} className={({ active }) => `cursor-pointer select-none px-2.5 py-1.5 ${active ? 'bg-neutral-700' : ''}`}>
                    <span className={`flex items-center gap-2 font-semibold ${factionTextClass(item)}`}>
                      <FactionIcon faction={item} className="h-5 w-5" />
                      <span className="truncate">{item}</span>
                    </span>
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </div>
          )}
        </Listbox>
        <Listbox value={priceMode} onChange={onPriceMode}>
          {({ open }) => {
            const current = PRICE_MODES.find((mode) => mode.id === priceMode) ?? PRICE_MODES[0];
            return (
              <div className="relative shrink-0">
                <Listbox.Button className={`flex h-full items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 bg-neutral-800/80 px-3 py-2 text-sm font-semibold text-neutral-200 transition-colors ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                  <span>{current.label}</span>
                  <Chevron open={open} />
                </Listbox.Button>
                <Listbox.Options className="absolute right-0 z-40 mt-1 w-64 overflow-auto rounded-md bg-neutral-800 py-1 text-sm shadow-lg ring-1 ring-black/40 focus:outline-none">
                  {PRICE_MODES.map((mode) => (
                    <Listbox.Option key={mode.id} value={mode.id} className={({ active }) => `cursor-pointer select-none px-2.5 py-1.5 ${active ? 'bg-neutral-700' : ''}`}>
                      {({ selected }) => (
                        <span className="block">
                          <span className={`block font-semibold ${selected ? 'text-white' : 'text-neutral-200'}`}>{mode.label}</span>
                          <span className="block text-[11px] font-normal leading-snug text-neutral-400">
                            {mode.id === 'auction-house' ? `Skips items below a ${minSaleRatePercent}% sale rate` : mode.title}
                          </span>
                        </span>
                      )}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
              </div>
            );
          }}
        </Listbox>
      </div>

      <div className="order-first mb-3 mt-3 flex flex-wrap items-center gap-1.5">
        <Link href="/" aria-label="WoWCraft home" className="mr-0.5 text-2xl font-semibold leading-none tracking-tight">
          <span className="text-[#e3b056]">WoW</span>Craft.io
        </Link>
        <div className="inline-flex rounded-md bg-neutral-800/80 p-0.5" role="radiogroup" aria-label="Game version">
          {versions.map((item) => {
            const selected = item === version;
            const label = item === 'The Burning Crusade' ? 'TBC' : item;
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onVersion(item)}
                className={`rounded px-2 py-0.5 text-xs font-semibold transition ${selected ? selectedFill(version) : 'text-neutral-400 hover:text-white'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleChart}
            aria-expanded={chartOpen}
            aria-label="Level-up cost history"
            className={`flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
              chartOpen
                ? 'border-yellow-300 bg-yellow-400/25 text-yellow-100'
                : 'border-yellow-400/50 bg-yellow-400/15 text-yellow-200 hover:border-yellow-300 hover:bg-yellow-400/25'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 15.5l4.2-4.2 2.6 2.6L17 6.5" />
              <path strokeLinecap="round" strokeWidth="1.8" d="M13 6.5h4v4" />
            </svg>
          </button>
          {settings}
          <button
            type="button"
            onClick={onClassic}
            className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:text-white"
          >
            Classic
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className="shrink-0 text-xs font-medium text-neutral-400">Skill Range:</span>
        <SkillField
          label="Current skill"
          value={skill}
          min={1}
          max={Math.max(1, target - 1)}
          className={valueClass(version)}
          onCommit={onSkillCommit}
        />
        <div className="relative min-w-0 flex-1 px-1">
          <Range
            values={[skill, target]}
            step={1}
            min={1}
            max={maxSkill}
            onChange={([low, high]) => onRangeChange(low, high)}
            onFinalChange={([low, high]) => onRangeCommit(low, high)}
            renderTrack={({ props, children }) => {
              const { key, style, ...rest } = props as typeof props & { key?: Key };
              return (
                <div
                  key={key}
                  {...rest}
                  onMouseDown={onSliderStart}
                  onTouchStart={onSliderStart}
                  style={{
                    ...style,
                    position: 'relative',
                    height: '4px',
                    width: '100%',
                    borderRadius: '2px',
                    background: getTrackBackground({
                      values: [skill, target],
                      colors: ['#4b5563', fill, '#4b5563'],
                      min: 1,
                      max: maxSkill,
                    }),
                  }}
                >
                  {gaps.map((segment) => {
                    const span = maxSkill - 1;
                    return (
                      <div
                        key={`${segment.kind}-${segment.from}`}
                        className="absolute bottom-[-12px] top-[-12px] z-[1] cursor-help"
                        style={{
                          left: `${((segment.from - 1) / span) * 100}%`,
                          width: `${((segment.to - segment.from) / span) * 100}%`,
                        }}
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const width = 224;
                          const gap = 12;
                          const fitsRight = rect.right + gap + width < window.innerWidth;
                          onGuideTip(fitsRight
                            ? { top: rect.top + rect.height / 2, left: rect.right + gap, center: true, kind: segment.kind, skill: segment.from }
                            : { top: rect.bottom + gap, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), center: false, kind: segment.kind, skill: segment.from });
                        }}
                        onMouseLeave={onGuideTipLeave}
                      >
                        <div
                          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2"
                          style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.72) 0 4px, rgba(255,255,255,0.14) 4px 7px)' }}
                        />
                      </div>
                    );
                  })}
                  {children}
                </div>
              );
            }}
            renderThumb={({ props, index }) => {
              const { key, style, ...rest } = props;
              const color = version === 'The Burning Crusade'
                ? '#059669'
                : version === 'Forever'
                  ? (index === 0 ? '#0273ae' : '#1fb5f7')
                  : (index === 0 ? '#eab308' : '#f59e0b');
              return (
                <div
                  key={key}
                  {...rest}
                  className="touch-manipulation"
                  style={{ ...style, width: thumb, height: thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, boxShadow: '0 0 4px rgba(0,0,0,0.5)' }} />
                </div>
              );
            }}
          />
        </div>
        <SkillField
          label="Target skill"
          value={target}
          min={skill + 1}
          max={maxSkill}
          className={valueClass(version)}
          onCommit={onTargetCommit}
        />
      </div>

      <PlannerNavLinks
        view={view}
        onView={onView}
        className="flex items-center gap-4 py-1.5 text-base font-medium"
      />
      {guideTip && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className={`pointer-events-none fixed z-[100] w-56 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-neutral-200 shadow-lg ${guideTip.center ? '-translate-y-1/2' : ''}`}
          style={{ top: guideTip.top, left: guideTip.left }}
        >
          {tipText}
        </div>,
        document.body
      )}
    </div>
  );
}
