const textEncoder = new TextEncoder();

function isWhitespaceCharacterCode(code: number): boolean {
  return (code >= 0x0009 && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff;
}

export interface TextStatistics {
  characterCount: number
  wordCount: number
  lineCount: number
  byteSize: number
}

export function getStringSizeInBytes(text: string) {
  return textEncoder.encode(text).buffer.byteLength;
}

/** Count the same UTF-16 characters, regex-separated words, and CR/LF lines without allocating split arrays. */
export function getTextStatistics(text: string): TextStatistics {
  const hasText = text !== '';
  let wordCount = hasText ? 1 : 0;
  let lineCount = hasText ? 1 : 0;
  let previousWasWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isWhitespace = isWhitespaceCharacterCode(code);
    if (isWhitespace && !previousWasWhitespace) {
      wordCount += 1;
    }
    previousWasWhitespace = isWhitespace;

    if (code === 0x000d) {
      lineCount += 1;
    }
    else if (code === 0x000a && text.charCodeAt(index - 1) !== 0x000d) {
      lineCount += 1;
    }
  }

  return {
    characterCount: text.length,
    wordCount,
    lineCount,
    byteSize: getStringSizeInBytes(text),
  };
}
