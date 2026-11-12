/** The task line shape accepted by the OpenSpec task parser and CLI. */
const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])/;

/** Parsed checkbox state and description, or undefined when the line is not an OpenSpec task. */
export function parseTaskLine(line: string): { state: string; text: string } | undefined {
  const match = TASK_LINE.exec(line);
  return match ? { state: match[1] ?? "", text: line.slice(match[0].length).trim() } : undefined;
}

export function taskLineState(line: string): string | undefined {
  return parseTaskLine(line)?.state;
}

/** One based file line numbers for tasks marked `[~]`. */
export function awaitingTaskLineNumbers(markdown: string): number[] {
  return markdown.split(/\r?\n/).flatMap((line, index) => taskLineState(line) === "~" ? [index + 1] : []);
}
