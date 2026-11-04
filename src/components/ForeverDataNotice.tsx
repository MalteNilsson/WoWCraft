type ForeverDataNoticeProps = {
  /** Full-width strip on the planner, or a card in page flow. */
  variant?: 'banner' | 'card';
  className?: string;
};

export function ForeverDataNotice({ variant = 'card', className = '' }: ForeverDataNoticeProps) {
  const frame = variant === 'banner'
    ? 'border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 pl-14 text-xs leading-relaxed desktop-layout:px-6 desktop-layout:text-sm'
    : 'rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed';

  return (
    <div role="note" className={`${frame} text-amber-100 ${className}`}>
      Forever is in simulated mode through skill 300. We are waiting for actual API data from TradeSkillMaster. Until Forever is in that API, these routes are not a confirmed plan.
    </div>
  );
}
