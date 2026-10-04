'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

export const AD_CLIENT = 'ca-pub-5113978673512478';
export const AD_SLOT_SKYSCRAPER = '4592909754';
export const AD_SLOT_LEADERBOARD = '5751054467';

const AD_SCRIPT = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;
const WIDE_QUERY = '(min-width: 1920px)';

declare global {
  interface Window {
    adsbygoogle?: object[];
  }
}

export function AdSlot({
  slot,
  width,
  height,
  className = '',
}: {
  slot: string;
  width: number;
  height: number;
  className?: string;
}) {
  const insRef = useRef<HTMLModElement>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const ins = insRef.current;
    if (!wide || !ins || ins.dataset.adsbygoogleStatus) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // React strict mode mounts twice in development.
    }
  }, [wide]);

  return (
    <div className={className}>
      <Script async src={AD_SCRIPT} crossOrigin="anonymous" strategy="afterInteractive" />
      {wide && (
        <ins
          ref={insRef}
          className="adsbygoogle"
          style={{ display: 'inline-block', width, height }}
          data-ad-client={AD_CLIENT}
          data-ad-slot={slot}
        />
      )}
    </div>
  );
}
