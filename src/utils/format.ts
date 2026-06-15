// Shared terminal-formatting helpers used by the reporters and the optimizer so
// every command wraps to the same width and never truncates actionable text.

// Terminal width, clamped to a sane range so output stays readable in both narrow
// panes and very wide terminals. Falls back to 80 when not attached to a TTY.
export function termWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(48, Math.min(cols, 100));
}

// Greedily wrap uncoloured text to lines no longer than `limit`. Call sites add
// their own left margin and colour, so the wrapping math is never thrown off by
// ANSI escape codes. A single word longer than the limit is left intact (no
// mid-word breaks — better to overflow a long path than mangle it).
export function wrap(text: string, limit: number): string[] {
  const cap = Math.max(8, limit);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= cap) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
