'use client';

import { AnimatePresence, motion } from 'framer-motion';

type SimulatedValuesWarningProps = {
  open: boolean;
  onAcknowledge: () => void;
};

export function SimulatedValuesWarning({ open, onAcknowledge }: SimulatedValuesWarningProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4"
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="simulated-values-title"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-md overflow-hidden rounded-xl border-2 border-amber-500/70 bg-neutral-900 shadow-2xl"
          >
            <div className="h-1 bg-amber-400" />
            <div className="p-6 desktop-layout:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                Simulated mode
              </p>
              <h2 id="simulated-values-title" className="mt-3 text-2xl font-bold text-amber-200 desktop-layout:text-3xl">
                Every value on this page is simulated
              </h2>
              <div className="mt-5 space-y-3 border-t border-neutral-800 pt-5 text-sm leading-relaxed text-neutral-200 desktop-layout:text-base">
                <p>
                  The gold costs, the route, and the shopping list are simulated values. They are not real auction house prices.
                </p>
                <p>
                  We are waiting for actual API data from TradeSkillMaster. Forever is not in that API yet, so these numbers stay simulated. Do not buy, sell, or stock materials from them.
                </p>
              </div>
              <button
                type="button"
                onClick={onAcknowledge}
                className="mt-6 w-full rounded-lg bg-amber-400 px-6 py-3.5 text-base font-bold text-neutral-950 transition-colors duration-200 hover:bg-amber-300"
              >
                I understand. These values are simulated.
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
