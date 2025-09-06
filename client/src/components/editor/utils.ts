import { editor as editorNS, Position, Range } from "monaco-editor";

export function excludeComments(line: string) {
  const blockCommentStartIdx = line.indexOf("/*");
  if (blockCommentStartIdx > -1) line = line.slice(0, blockCommentStartIdx);

  const lineCommentStartIdx = line.indexOf("--");
  if (lineCommentStartIdx > -1) line = line.slice(0, blockCommentStartIdx);

  return line;
}

export function activeQueryRange(
  text: string,
  position: Position,
): Range | null {
  const lines = text.split("\n");

  const cursorLineIdx = position.lineNumber - 1;
  let startLineIdx = cursorLineIdx;
  let endLineIdx = cursorLineIdx;
  const excludedLines = new Set();

  // first, scan for comments and exclude any blank lines,
  // lines entirely contained within a block comment, and
  // lines that only contain a line comment
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // skip line comments
    if (line.startsWith("--")) {
      excludedLines.add(i);
      continue;
    }

    // exclude block comment start/end lines
    if (line.startsWith("/*") || line.startsWith("*/")) {
      excludedLines.add(i);
    }

    if (inComment && lines[i].includes("*/")) inComment = false;
    if (inComment) excludedLines.add(i);
    if (lines[i].includes("/*")) inComment = true;
  }

  // if we're on an excluded line, don't highlight anything
  if (excludedLines.has(cursorLineIdx) || lines[cursorLineIdx] === "") {
    return null;
  }

  // move backwards to find start line
  let prevLineIdx = cursorLineIdx;
  for (let i = cursorLineIdx; i >= 0; i--) {
    if (excludedLines.has(i)) continue;

    if (
      lines[i] === "" ||
      i !== cursorLineIdx && excludeComments(lines[i]).includes(";")
    ) {
      startLineIdx = prevLineIdx;
      break;
    }

    startLineIdx = i;
    prevLineIdx = i;
  }

  // move forwards to find end line
  for (; endLineIdx < lines.length; endLineIdx++) {
    if (excludedLines.has(endLineIdx)) continue;

    if (excludeComments(lines[endLineIdx]).includes(";")) {
      break;
    }

    // once we hit an empty line, stop; this prevents the situation where
    // we're editing a new query a couple lines above an existing query,
    // and the two queries appear to be a single query until a semicolon
    // is added
    if (lines[endLineIdx] === "") {
      endLineIdx -= 1;
      break;
    }
  }

  return new Range(startLineIdx! + 1, 1, endLineIdx! + 1, 1);
}

export function textInLineRange(text: string, range: Range): string {
  const lines = text.split("\n");
  return lines.slice(range.startLineNumber - 1, range.endLineNumber).join("\n");
}

export function activeQuery(
  model: editorNS.ITextModel,
  position: Position,
): { query: string; offset: number } | null {
  const text = model.getValue();
  const range = position ? activeQueryRange(text, position) : null;
  return range
    ? {
      query: textInLineRange(text, range),
      offset: model.getOffsetAt(
        new Position(range.startLineNumber, range.startColumn),
      ),
    }
    : null;
}
