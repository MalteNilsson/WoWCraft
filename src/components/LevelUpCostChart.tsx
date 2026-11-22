'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Listbox } from '@headlessui/react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FactionIcon, factionRingClass, factionTextClass } from '@/components/FactionMark';
import { RealmName, realmRingClass } from '@/components/RealmName';
import { FormatMoney } from '@/lib/utils';

type CostPoint = {
  at: string;
  copper: number;
};

type LevelUpCostChartProps = {
  open: boolean;
  onClose: () => void;
  version: string;
  profession: string;
  professions: string[];
  realm: string;
  realms: string[];
  faction: string;
  factions: string[];
  stroke: string;
};

function goldTick(copper: number): string {
  const gold = copper / 10000;
  if (gold >= 100) return `${Math.round(gold).toLocaleString()}g`;
  if (gold >= 10) return `${gold.toFixed(0)}g`;
  return `${gold.toFixed(1)}g`;
}

function observedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const TIMELINES = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All-time' },
  { id: 'custom', label: 'Custom' },
] as const;

type TimelineId = (typeof TIMELINES)[number]['id'];

const menuButtonClass = 'flex w-full items-center justify-between gap-1 rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1.5 text-sm transition-colors duration-150 min-w-0';
const menuOptionsClass = 'absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-sm shadow-lg ring-1 ring-black/40 focus:outline-none';

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function endOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function dateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterByTimeline(points: CostPoint[], timeline: TimelineId, customFrom: string, customTo: string): CostPoint[] {
  if (timeline === 'all') return points;
  let from = Number.NEGATIVE_INFINITY;
  let to = Number.POSITIVE_INFINITY;
  if (timeline === '7d' || timeline === '30d') {
    const start = new Date();
    start.setDate(start.getDate() - (timeline === '7d' ? 6 : 29));
    from = startOfLocalDay(start);
    to = endOfLocalDay(new Date());
  } else {
    const fromDate = parseDateInput(customFrom);
    const toDate = parseDateInput(customTo);
    if (fromDate) from = startOfLocalDay(fromDate);
    if (toDate) to = endOfLocalDay(toDate);
  }
  return points.filter((point) => {
    const time = new Date(point.at).getTime();
    return time >= from && time <= to;
  });
}

function MenuChevron({ open }: { open: boolean }) {
  return (
    <svg className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

export function LevelUpCostChart({
  open,
  onClose,
  version,
  profession,
  professions,
  realm,
  realms,
  faction,
  factions,
  stroke,
}: LevelUpCostChartProps) {
  const [chartProfession, setChartProfession] = useState(profession);
  const [chartRealm, setChartRealm] = useState(realm);
  const [chartFaction, setChartFaction] = useState(faction);
  const [points, setPoints] = useState<CostPoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [timeline, setTimeline] = useState<TimelineId>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setChartProfession(profession);
      setChartRealm(realm);
      setChartFaction(faction);
    }
    wasOpen.current = open;
  }, [open, profession, realm, faction]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || version !== 'Forever') return;
    const controller = new AbortController();
    setPoints(null);
    setFailed(false);
    const params = new URLSearchParams({
      profession: chartProfession,
      realm: chartRealm,
      faction: chartFaction,
    });
    fetch(`/api/profession-costs?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { points?: CostPoint[] };
        setPoints(body.points ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
        setPoints([]);
      });
    return () => controller.abort();
  }, [open, version, chartProfession, chartRealm, chartFaction]);

  if (!open || typeof document === 'undefined') return null;

  const visiblePoints = points == null ? null : filterByTimeline(points, timeline, customFrom, customTo);
  const ready = version === 'Forever' && visiblePoints != null && visiblePoints.length > 0;
  const rangeEmpty = version === 'Forever' && points != null && points.length > 0 && visiblePoints != null && visiblePoints.length === 0 && !failed;

  const chooseTimeline = (next: TimelineId) => {
    setTimeline(next);
    if (next === 'custom' && !customFrom && !customTo && points && points.length > 0) {
      setCustomFrom(dateInputValue(points[0].at));
      setCustomTo(dateInputValue(points[points.length - 1].at));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center p-3 desktop-layout:items-center desktop-layout:p-6">
      <button
        type="button"
        aria-label="Close level-up cost history"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-up-cost-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-neutral-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="level-up-cost-title" className="text-2xl font-semibold tracking-tight text-white">
              Level-up cost
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-300">
              Cost to reach skill 300 from 1
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-neutral-400 transition-colors hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-3 grid grid-cols-1 gap-2 desktop-layout:grid-cols-3">
            <div className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-neutral-400">Profession</span>
              <Listbox value={chartProfession} onChange={setChartProfession}>
                {({ open }) => (
                  <div className="relative">
                    <Listbox.Button className={`${menuButtonClass} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                        <img src={`/icons/${chartProfession.toLowerCase()}.webp`} alt="" className="h-6 w-6 shrink-0" />
                        <span className="truncate">{chartProfession}</span>
                      </span>
                      <MenuChevron open={open} />
                    </Listbox.Button>
                    <Listbox.Options className={menuOptionsClass}>
                      {professions.map((name) => (
                        <Listbox.Option key={name} value={name} className={({ active }) => `relative cursor-pointer select-none py-1.5 pl-2 pr-3 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                          {({ selected }) => (
                            <span className={`flex items-center gap-2 font-semibold ${selected ? 'text-white' : ''}`}>
                              <img src={`/icons/${name.toLowerCase()}.webp`} alt="" className="h-6 w-6 shrink-0" />
                              <span className="truncate">{name}</span>
                            </span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
            <div className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-neutral-400">Realm</span>
              <Listbox value={chartRealm} onChange={setChartRealm}>
                {({ open }) => (
                  <div className="relative">
                    <Listbox.Button className={`${menuButtonClass} ${realmRingClass(chartRealm)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className="truncate font-semibold"><RealmName realm={chartRealm} /></span>
                      <MenuChevron open={open} />
                    </Listbox.Button>
                    <Listbox.Options className={menuOptionsClass}>
                      {realms.map((name) => (
                        <Listbox.Option key={name} value={name} className={({ active }) => `relative cursor-pointer select-none py-1.5 pl-2 pr-3 ${active ? 'bg-neutral-700' : ''}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${selected ? '' : 'opacity-80'}`}><RealmName realm={name} /></span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
            <div className="min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-neutral-400">Faction</span>
              <Listbox value={chartFaction} onChange={setChartFaction}>
                {({ open }) => (
                  <div className="relative">
                    <Listbox.Button className={`${menuButtonClass} ${factionRingClass(chartFaction)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className={`flex min-w-0 items-center gap-1.5 font-semibold ${factionTextClass(chartFaction)}`}>
                        <FactionIcon faction={chartFaction} className="h-5 w-5" />
                        <span className="truncate">{chartFaction}</span>
                      </span>
                      <MenuChevron open={open} />
                    </Listbox.Button>
                    <Listbox.Options className={menuOptionsClass}>
                      {factions.map((name) => (
                        <Listbox.Option key={name} value={name} className={({ active }) => `relative cursor-pointer select-none py-1.5 pl-2 pr-3 ${active ? 'bg-neutral-700' : ''}`}>
                          {({ selected }) => (
                            <span className={`flex items-center gap-2 truncate font-semibold ${factionTextClass(name)} ${selected ? '' : 'opacity-80'}`}>
                              <FactionIcon faction={name} className="h-5 w-5" />
                              {name}
                            </span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
          </div>
          <div className="mb-3">
            <span className="mb-1 block text-[11px] font-medium text-neutral-400">Timeline</span>
            <div className="flex flex-wrap gap-1.5">
              {TIMELINES.map((option) => {
                const selected = timeline === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseTimeline(option.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                      selected
                        ? 'border-white/25 bg-white/10 text-white'
                        : 'border-white/10 bg-neutral-800/80 text-neutral-400 hover:bg-neutral-700/70 hover:text-neutral-200'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {timeline === 'custom' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className="rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1.5 text-sm text-white [color-scheme:dark]"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className="rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1.5 text-sm text-white [color-scheme:dark]"
                  />
                </label>
              </div>
            )}
          </div>
          {version !== 'Forever' && (
            <p className="py-16 text-center text-sm text-neutral-300">
              Level-up cost history is recorded for Forever.
            </p>
          )}
          {version === 'Forever' && points == null && !failed && (
            <p className="py-16 text-center text-sm text-neutral-400">Loading cost history…</p>
          )}
          {version === 'Forever' && failed && (
            <p className="py-16 text-center text-sm text-neutral-300">The cost history could not be loaded.</p>
          )}
          {version === 'Forever' && points != null && points.length === 0 && !failed && (
            <p className="py-16 text-center text-sm text-neutral-300">
              No leveling cost history for this profession on this realm.
            </p>
          )}
          {rangeEmpty && (
            <p className="py-16 text-center text-sm text-neutral-300">
              No recorded costs in this date range.
            </p>
          )}
          {ready && (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visiblePoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="at"
                    tickFormatter={(value: string) => {
                      const date = new Date(value);
                      if (Number.isNaN(date.getTime())) return '';
                      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                    minTickGap={32}
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="copper"
                    tickFormatter={goldTick}
                    width={64}
                    tick={{ fill: '#a3a3a3', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as CostPoint;
                      return (
                        <div className="rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-xs shadow-lg">
                          <div className="mb-1 text-neutral-400">{observedLabel(point.at)}</div>
                          <FormatMoney copper={point.copper} />
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="copper"
                    stroke={stroke}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            Each point is the recorded cost for <span className="text-neutral-300">{chartProfession}</span> on <span className="text-neutral-300">{chartRealm}</span>, <span className="text-neutral-300">{chartFaction}</span>, when those auction prices were saved.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
