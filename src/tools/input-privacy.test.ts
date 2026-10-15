// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSourceFile, forEachChild, isCallExpression, isIdentifier, isStringLiteral, ScriptKind, ScriptTarget, type Node } from 'typescript';
import { tools } from './index';
import { clearLegacyToolContent, hasMemoryOnlyContent, legacyToolContentKeys } from './input-privacy';

afterEach(() => vi.unstubAllGlobals());

describe('tool input privacy', () => {
  it('clears only this tool and never reads saved values', () => {
    const savedKeys = new Set(['url-query-builder:base-url', 'url-query-builder:parameters', 'url-query-builder:sort-keys', 'env-vars-parser:env']);
    const storage = {
      getItem: vi.fn(() => { throw new Error('Saved content must not be read.'); }),
      removeItem: vi.fn((key: string) => savedKeys.delete(key)),
    };

    expect(clearLegacyToolContent('/url-query-builder', storage)).toBe(true);
    expect(savedKeys).toEqual(new Set(['url-query-builder:sort-keys', 'env-vars-parser:env']));
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });

  it('continues clearing later keys after one removal fails', () => {
    const removeItem = vi.fn((key: string) => {
      if (key === 'robots-txt-tester:robots') {
        throw new Error('Storage is blocked for test data.');
      }
    });

    expect(clearLegacyToolContent('/robots-txt-tester', { removeItem })).toBe(false);
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
      'robots-txt-tester:robots', 'robots-txt-tester:url', 'robots-txt-tester:user-agent',
    ]);
  });

  it('reports unavailable storage without throwing', () => {
    expect(clearLegacyToolContent('/cookie-parser', null)).toBe(false);
    vi.stubGlobal('window', {
      get localStorage() { throw new Error('Browser storage is blocked.'); },
    });
    expect(clearLegacyToolContent('/cookie-parser')).toBe(false);
  });

  it.each(['/unknown', '__proto__', 'constructor', 'toString'])('ignores unknown or inherited path %s', (path) => {
    const removeItem = vi.fn();
    expect(hasMemoryOnlyContent(path)).toBe(false);
    expect(clearLegacyToolContent(path, { removeItem })).toBe(true);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('does not need storage for tools that have no legacy content', () => {
    const storageAccess = vi.fn(() => { throw new Error('Storage must not be accessed.'); });
    vi.stubGlobal('window', { get localStorage() { return storageAccess(); } });
    expect(hasMemoryOnlyContent('/hmac-generator')).toBe(true);
    expect(clearLegacyToolContent('/hmac-generator')).toBe(true);
    expect(storageAccess).not.toHaveBeenCalled();
  });

  it('associates unique exact cleanup keys with registered canonical tool paths', () => {
    const registeredPaths = new Set(tools.map(tool => tool.path));
    const keys = Object.values(legacyToolContentKeys).flat();

    for (const path of Object.keys(legacyToolContentKeys)) {
      expect(registeredPaths.has(path), path).toBe(true);
      expect(hasMemoryOnlyContent(path)).toBe(true);
    }
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(key => key.length > 0)).toBe(true);
  });

  it('keeps migrated content out of useStorage and direct storage writes', () => {
    const forbiddenKeys = new Set(Object.values(legacyToolContentKeys).flat());
    const vueSources = import.meta.glob<string>('./**/*.vue', { query: '?raw', import: 'default', eager: true });
    const violations: string[] = [];

    for (const [path, source] of Object.entries(vueSources)) {
      const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
      const ast = createSourceFile(path, script, ScriptTarget.Latest, true, ScriptKind.TS);

      function visit(node: Node) {
        if (isCallExpression(node)) {
          const argument = node.arguments[0];
          const callee = node.expression;
          const persists = (isIdentifier(callee) && callee.text === 'useStorage') || /\.setItem$/.test(callee.getText(ast));
          if (persists && argument && isStringLiteral(argument) && forbiddenKeys.has(argument.text)) {
            violations.push(`${path}: ${argument.text}`);
          }
        }
        forEachChild(node, visit);
      }
      visit(ast);
    }

    expect(violations).toEqual([]);
  });
});
