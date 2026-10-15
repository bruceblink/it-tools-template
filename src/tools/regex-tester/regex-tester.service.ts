export interface GroupCapture {
  name: string
  value: string
  start: number
  end: number
};

export interface RegexMatch {
  index: number
  value: string
  captures: GroupCapture[]
  groups: GroupCapture[]
}

export interface RegexMatchSummary {
  matchCount: number
  captureCount: number
  groupCount: number
  coveredCharacters: number
  coveragePercent: number
}

export function matchRegex(regex: string, text: string, flags: string): RegexMatch[] {
  // if (regex === '' || text === '') {
  //   return [];
  // }

  let lastIndex = -1;
  // Match indices are required to report capture offsets, so enable the d flag when the caller omits it.
  const re = new RegExp(regex, flags.includes('d') ? flags : `${flags}d`);
  const results: RegexMatch[] = [];
  let match = re.exec(text);
  while (match !== null) {
    if (re.lastIndex === lastIndex || match[0] === '') {
      break;
    }
    const indices = match.indices;
    if (!indices) {
      break;
    }
    const captures: Array<GroupCapture> = [];
    Object.entries(match).forEach(([captureName, captureValue]) => {
      if (captureName !== '0' && captureName.match(/\d+/)) {
        const captureIndices = indices[Number(captureName)];
        if (!captureIndices || typeof captureValue !== 'string') {
          return;
        }

        captures.push({
          name: captureName,
          value: captureValue,
          start: captureIndices[0],
          end: captureIndices[1],
        });
      }
    });
    const groups: Array<GroupCapture> = [];
    Object.entries(match.groups || {}).forEach(([groupName, groupValue]) => {
      const groupIndices = indices.groups?.[groupName];
      if (!groupIndices || typeof groupValue !== 'string') {
        return;
      }

      groups.push({
        name: groupName,
        value: groupValue,
        start: groupIndices[0],
        end: groupIndices[1],
      });
    });
    results.push({
      index: match.index,
      value: match[0],
      captures,
      groups,
    });
    lastIndex = re.lastIndex;
    match = re.exec(text);
  }
  return results;
}

export function summarizeRegexMatches(matches: RegexMatch[], text: string): RegexMatchSummary {
  const coveredCharacters = matches.reduce((total, match) => total + match.value.length, 0);
  const textLength = text.length;

  return {
    matchCount: matches.length,
    captureCount: matches.reduce((total, match) => total + match.captures.length, 0),
    groupCount: matches.reduce((total, match) => total + match.groups.length, 0),
    coveredCharacters,
    coveragePercent: textLength === 0 ? 0 : Math.round((coveredCharacters / textLength) * 100),
  };
}
