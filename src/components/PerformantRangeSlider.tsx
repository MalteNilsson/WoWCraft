'use client';

import { useRef, useCallback, useEffect } from 'react';
import { getTrackBackground } from 'react-range';

function normalizeValue(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  const stepped = Math.round(clamped / step) * step;
  return parseFloat(stepped.toFixed(step >= 1 ? 0 : 1));
}

interface PerformantRangeSliderProps {
  values: [number, number];
  min: number;
  max: number;
  step?: number;
  onChange: (values: [number, number]) => void;
  onDragChange?: (values: [number, number]) => void; // Throttled during drag for visual updates
  onDragStart?: () => void;
  trackColors?: [string, string, string];
  thumbSize?: number;
  thumbColors?: [string, string]; // [thumb0, thumb1] - default gray for both
  thumbInnerSize?: number; // inner circle size, default 12
  trackHeight?: string;
  className?: string;
}

export function PerformantRangeSlider({
  values,
  min,
  max,
  step = 1,
  onChange,
  onDragChange,
  onDragStart,
  trackColors = ['#4b5563', '#d1d5db', '#4b5563'],
  thumbSize = 20,
  thumbColors,
  thumbInnerSize = 12,
  trackHeight = '2px',
  className = '',
}: PerformantRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumb0Ref = useRef<HTMLDivElement>(null);
  const thumb1Ref = useRef<HTMLDivElement>(null);
  const valuesRef = useRef<[number, number]>(values);
  const draggingRef = useRef<number | null>(null);
  const startValuesRef = useRef<[number, number]>([0, 0]);

  valuesRef.current = values;

  const valueToPercent = useCallback(
    (v: number) => (max - min === 0 ? 0 : ((v - min) / (max - min)) * 100),
    [min, max]
  );

  const percentToValue = useCallback(
    (p: number) => {
      const v = min + (p / 100) * (max - min);
      return normalizeValue(v, min, max, step);
    },
    [min, max, step]
  );

  const updateDOM = useCallback(
    (low: number, high: number) => {
      const track = trackRef.current;
      const thumb0 = thumb0Ref.current;
      const thumb1 = thumb1Ref.current;
      if (!track || !thumb0 || !thumb1) return;

      const p0 = valueToPercent(low);
      const p1 = valueToPercent(high);

      thumb0.style.left = `${p0}%`;
      thumb0.style.transform = 'translate(-50%, -50%)';
      thumb1.style.left = `${p1}%`;
      thumb1.style.transform = 'translate(-50%, -50%)';

      track.style.background = getTrackBackground({
        values: [low, high],
        colors: trackColors,
        min,
        max,
      });
    },
    [min, max, trackColors, valueToPercent]
  );

  const getValueFromClientX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const p = Math.max(0, Math.min(100, (x / rect.width) * 100));
      return percentToValue(p);
    },
    [min, percentToValue]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: 0 | 1) => {
      e.preventDefault();
      draggingRef.current = index;
      startValuesRef.current = [...valuesRef.current];
      onDragStart?.();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onDragStart]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const idx = draggingRef.current;
      if (idx === null) return;

      const newVal = getValueFromClientX(e.clientX);
      let [low, high] = startValuesRef.current;

      if (idx === 0) {
        low = normalizeValue(newVal, min, high - step, step);
      } else {
        high = normalizeValue(newVal, low + step, max, step);
      }

      valuesRef.current = [low, high];
      updateDOM(low, high);
      (onDragChange ?? onChange)([low, high]);
    },
    [min, max, step, getValueFromClientX, updateDOM, onChange, onDragChange]
  );

  const handlePointerUp = useCallback(
    () => {
      if (draggingRef.current === null) return;
      const [low, high] = valuesRef.current;
      draggingRef.current = null;
      onChange([low, high]);
    },
    [onChange]
  );

  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // Sync DOM when values change from parent (e.g. +/- buttons, input)
  useEffect(() => {
    if (draggingRef.current === null) {
      updateDOM(values[0], values[1]);
    }
  }, [values[0], values[1], updateDOM]);

  const p0 = valueToPercent(values[0]);
  const p1 = valueToPercent(values[1]);

  return (
    <div className={`relative w-full ${className}`}>
      <div
        ref={trackRef}
        className="relative w-full touch-none select-none"
        style={{ touchAction: 'none' }}
        style={{
          height: trackHeight,
          borderRadius: '2px',
          background: getTrackBackground({
            values: [values[0], values[1]],
            colors: trackColors,
            min,
            max,
          }),
        }}
      >
        <div
          ref={thumb0Ref}
          onPointerDown={(e) => handlePointerDown(e, 0)}
          className="absolute top-1/2 touch-manipulation cursor-grab active:cursor-grabbing"
          style={{
            left: `${p0}%`,
            transform: 'translate(-50%, -50%)',
            width: thumbSize,
            height: thumbSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: thumbInnerSize,
              height: thumbInnerSize,
              borderRadius: thumbInnerSize / 2,
              backgroundColor: thumbColors?.[0] ?? '#9ca3af',
              boxShadow: '0 0 2px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          />
        </div>
        <div
          ref={thumb1Ref}
          onPointerDown={(e) => handlePointerDown(e, 1)}
          className="absolute top-1/2 touch-manipulation cursor-grab active:cursor-grabbing"
          style={{
            left: `${p1}%`,
            transform: 'translate(-50%, -50%)',
            width: thumbSize,
            height: thumbSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: thumbInnerSize,
              height: thumbInnerSize,
              borderRadius: thumbInnerSize / 2,
              backgroundColor: thumbColors?.[1] ?? '#9ca3af',
              boxShadow: '0 0 2px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}
