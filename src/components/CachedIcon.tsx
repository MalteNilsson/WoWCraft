'use client';

import { useState, useEffect } from 'react';
import { getIconUrl, getIconFallbackUrl } from '@/lib/iconStore';

interface CachedIconProps {
  category: string;
  id: number;
  alt?: string;
  className?: string;
}

/**
 * Renders an icon from the zip cache (IndexedDB). Waits for cache before rendering to avoid
 * individual requests. Falls back to direct URL if icon not in zip.
 */
export function CachedIcon({ category, id, alt = '', className = '' }: CachedIconProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getIconUrl(category, id).then((u) => {
      if (!cancelled) setUrl(u ?? getIconFallbackUrl(category, id));
    });
    return () => { cancelled = true; };
  }, [category, id]);

  if (!url) {
    return <span className={`inline-block bg-neutral-800 animate-pulse ${className}`} aria-hidden />;
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
