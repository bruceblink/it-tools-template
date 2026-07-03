export type RobotsDirective = 'allow' | 'disallow';

export interface RobotsRule {
  directive: RobotsDirective
  pattern: string
  lineNumber: number
}

export interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
  crawlDelay?: string
}

export interface MatchedRobotsRule extends RobotsRule {
  matchLength: number
}

export interface RobotsTxtAnalysis {
  allowed: boolean
  userAgent: string
  url: string
  path: string
  matchedRule?: MatchedRobotsRule
  matchedAgents: string[]
  crawlDelay?: string
  sitemaps: string[]
  groups: RobotsGroup[]
  warnings: string[]
}

const DEFAULT_USER_AGENT = '*';

function stripComment(line: string): string {
  const commentIndex = line.indexOf('#');
  return commentIndex === -1 ? line.trim() : line.slice(0, commentIndex).trim();
}

function splitDirective(line: string): { name: string, value: string } | undefined {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return undefined;
  }

  return {
    name: line.slice(0, separatorIndex).trim().toLowerCase(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function ensureGroup(groups: RobotsGroup[]): RobotsGroup {
  const lastGroup = groups[groups.length - 1];
  if (lastGroup) {
    return lastGroup;
  }

  const group: RobotsGroup = { agents: [], rules: [] };
  groups.push(group);
  return group;
}

export function parseRobotsTxt(input: string): { groups: RobotsGroup[], sitemaps: string[], warnings: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const warnings: string[] = [];

  for (const [index, rawLine] of input.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const lineNumber = index + 1;
    const line = stripComment(rawLine);
    if (!line) {
      continue;
    }

    const directive = splitDirective(line);
    if (!directive) {
      warnings.push(`Line ${lineNumber} has no directive separator.`);
      continue;
    }

    if (directive.name === 'sitemap') {
      if (directive.value) {
        sitemaps.push(directive.value);
      }
      continue;
    }

    if (directive.name === 'user-agent') {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.rules.length > 0 || lastGroup.crawlDelay !== undefined) {
        groups.push({ agents: [directive.value || DEFAULT_USER_AGENT], rules: [] });
      }
      else {
        lastGroup.agents.push(directive.value || DEFAULT_USER_AGENT);
      }
      continue;
    }

    if (directive.name === 'allow' || directive.name === 'disallow') {
      const group = ensureGroup(groups);
      if (group.agents.length === 0) {
        group.agents.push(DEFAULT_USER_AGENT);
        warnings.push(`Line ${lineNumber} has ${directive.name} before any user-agent; assigned to "*".`);
      }

      if (directive.name === 'disallow' && directive.value === '') {
        continue;
      }

      group.rules.push({
        directive: directive.name,
        pattern: directive.value || '/',
        lineNumber,
      });
      continue;
    }

    if (directive.name === 'crawl-delay') {
      const group = ensureGroup(groups);
      if (group.agents.length === 0) {
        group.agents.push(DEFAULT_USER_AGENT);
      }
      group.crawlDelay = directive.value;
    }
  }

  return { groups, sitemaps, warnings };
}

function normalizePath(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  }
  catch {
    if (!url.startsWith('/')) {
      throw new Error('URL must be absolute or start with "/".');
    }
    return url;
  }
}

function agentMatchLength(agent: string, userAgent: string): number {
  const normalizedAgent = agent.trim().toLowerCase();
  const normalizedUserAgent = userAgent.trim().toLowerCase();

  if (normalizedAgent === DEFAULT_USER_AGENT) {
    return 1;
  }

  return normalizedUserAgent.includes(normalizedAgent) ? normalizedAgent.length : 0;
}

function getMatchingGroups(groups: RobotsGroup[], userAgent: string): RobotsGroup[] {
  const scoredGroups = groups
    .map(group => ({
      group,
      score: Math.max(0, ...group.agents.map(agent => agentMatchLength(agent, userAgent))),
    }))
    .filter(({ score }) => score > 0);
  const bestScore = Math.max(0, ...scoredGroups.map(({ score }) => score));

  return scoredGroups
    .filter(({ score }) => score === bestScore)
    .map(({ group }) => group);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function ruleToRegex(pattern: string): RegExp {
  const anchoredAtEnd = pattern.endsWith('$');
  const cleanPattern = anchoredAtEnd ? pattern.slice(0, -1) : pattern;
  const regexBody = cleanPattern
    .split('*')
    .map(escapeRegex)
    .join('.*');

  return new RegExp(`^${regexBody}${anchoredAtEnd ? '$' : ''}`);
}

function findMatchingRule(rules: RobotsRule[], path: string): MatchedRobotsRule | undefined {
  const matchingRules = rules
    .filter(rule => ruleToRegex(rule.pattern).test(path))
    .map(rule => ({
      ...rule,
      matchLength: rule.pattern.replace(/\*|\$/g, '').length,
    }))
    .sort((left, right) => {
      if (right.matchLength !== left.matchLength) {
        return right.matchLength - left.matchLength;
      }

      if (left.directive !== right.directive) {
        return left.directive === 'allow' ? -1 : 1;
      }

      return left.lineNumber - right.lineNumber;
    });

  return matchingRules[0];
}

export function testRobotsTxt(robotsTxt: string, url: string, userAgent = DEFAULT_USER_AGENT): RobotsTxtAnalysis {
  const path = normalizePath(url);
  const { groups, sitemaps, warnings } = parseRobotsTxt(robotsTxt);
  const matchingGroups = getMatchingGroups(groups, userAgent || DEFAULT_USER_AGENT);
  const rules = matchingGroups.flatMap(({ rules }) => rules);
  const matchedRule = findMatchingRule(rules, path);
  const matchedAgents = [...new Set(matchingGroups.flatMap(({ agents }) => agents))];
  const crawlDelay = matchingGroups.find(group => group.crawlDelay !== undefined)?.crawlDelay;

  return {
    allowed: matchedRule ? matchedRule.directive === 'allow' : true,
    userAgent: userAgent || DEFAULT_USER_AGENT,
    url,
    path,
    matchedRule,
    matchedAgents,
    crawlDelay,
    sitemaps,
    groups,
    warnings,
  };
}
