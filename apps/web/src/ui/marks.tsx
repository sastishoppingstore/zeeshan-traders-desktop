/**
 * Status and tool marks drawn in CSS — the interface ships no emoji and no SVG icon files.
 * Every mark inherits `currentColor` and sizes itself in `em`, so it scales with the text
 * it sits beside (.err, .notice, .toast, buttons).
 */
import React from 'react';

export type MarkKind =
  | 'warn' | 'check' | 'check-circle' | 'x' | 'ban' | 'info'
  | 'sync' | 'print' | 'share' | 'download' | 'lock' | 'key' | 'search'
  | 'menu' | 'plus' | 'user' | 'tray' | 'status' | 'arrow' | 'clock' | 'mail' | 'pin';

export function Mark({ kind, className = '' }: { kind: MarkKind; className?: string }) {
  return <span className={`mark mark-${kind} ${className}`.trim()} aria-hidden="true" />;
}
