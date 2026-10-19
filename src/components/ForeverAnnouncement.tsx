'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const COOKIE_NAME = 'wowcraft-forever-announced';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function hasAnnouncementCookie(): boolean {
  return document.cookie.split('; ').some((part) => part.startsWith(`${COOKIE_NAME}=`));
}

function rememberAnnouncementDismissed() {
  document.cookie = `${COOKIE_NAME}=1; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function ForeverAnnouncement() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasAnnouncementCookie()) setOpen(true);
  }, []);

  function dismiss() {
    rememberAnnouncementDismissed();
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 p-4"
          onClick={dismiss}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forever-announcement-title"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-md overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="h-1 bg-[#e3b056]" />
            <div className="p-6 desktop-layout:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#e3b056]">
                Now in the planner
              </p>
              <h2 id="forever-announcement-title" className="mt-3 text-2xl font-bold text-white desktop-layout:text-3xl">
                <span className="text-[#1fb5f7]">Forever</span> is in <span className="text-[#e3b056]">WoW</span>Craft
              </h2>
              <div className="mt-5 space-y-3 border-t border-neutral-800 pt-5 text-sm leading-relaxed text-neutral-300 desktop-layout:text-base">
                <p>
                  World of Warcraft: Forever is now a version in the planner, with its own recipes and auction prices, through skill 225.
                </p>
                <p>
                  It opens by default. The Burning Crusade is still in the version menu when you want it.
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="mt-6 w-full rounded-lg bg-[#1fb5f7] px-6 py-3.5 text-base font-bold text-neutral-950 transition-colors duration-200 hover:bg-[#64cbfb]"
              >
                Continue
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
