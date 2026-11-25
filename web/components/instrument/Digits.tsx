"use client";

import { useLayoutEffect, useRef } from "react";
import { rollDigits } from "@/lib/motion/roll-digits";

export interface DigitsProps {
  /** The reading as written, for example formatBlock(snapshot.block). */
  value: string;
  className?: string;
}

/**
 * A mono tabular number, one span per character (spec 2026-11-23 section 5.1). React writes the value; when a new
 * reading replaces an earlier one of the same length, rollDigits rolls in only the characters that changed. The first
 * reading never rolls (section 8.1, rule 3: never count), and neither does a reading that changed length.
 */
export function Digits({ value, className }: DigitsProps) {
  const root = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const el = root.current;
    if (from === value || el === null) return;
    rollDigits([...el.children] as HTMLElement[], from, value);
  }, [value]);
  return (
    <span ref={root} data-digits="" className={className ? `digits ${className}` : "digits"}>
      {[...value].map((ch, i) => (
        // One cell per position: a cell keeps its place when its character changes, which is what rolls.
        <span key={i}>{ch}</span>
      ))}
    </span>
  );
}
