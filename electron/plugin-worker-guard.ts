export const pluginWorkerConcurrencyLimit = 2;
export const pluginWorkerLifetimeMs = 30_000;

/**
 * Return the first script that runs in each plugin document. The constructor
 * proxy enforces a per-window worker count and lifetime without exposing a
 * host IPC bridge to the plugin renderer.
 */
export function getPluginWorkerGuardScript(lifetimeMs = pluginWorkerLifetimeMs): string {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 60_000) {
    throw new RangeError('The plugin worker lifetime must be between 1 and 60,000 milliseconds.');
  }

  return `(() => {
  const marker = '__itToolsPluginWorkerGuardInstalled';
  if (Object.prototype.hasOwnProperty.call(globalThis, marker)) {
    return;
  }
  Object.defineProperty(globalThis, marker, { value: true, writable: false, configurable: false });

  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const activeWorkers = new Map();
  const NativeWorker = globalThis.Worker;

  function failClosed() {
    const head = document.head || document.documentElement.insertBefore(
      document.createElement('head'),
      document.documentElement.firstChild,
    );
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "worker-src 'none'";
    head.appendChild(policy);
  }

  function replaceGlobalValue(name, value, required) {
    let replaced = false;
    for (let owner = globalThis; owner; owner = Object.getPrototypeOf(owner)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (!descriptor) {
        continue;
      }
      if (!descriptor.configurable && !descriptor.writable) {
        if (required) {
          throw new TypeError('The plugin worker API cannot be guarded.');
        }
        continue;
      }
      Object.defineProperty(owner, name, { value, writable: false, configurable: false });
      replaced = true;
    }
    if (!replaced && required) {
      Object.defineProperty(globalThis, name, { value, writable: false, configurable: false });
    }
  }

  try {
    if (typeof NativeWorker !== 'function') {
      throw new TypeError('The plugin worker constructor is unavailable.');
    }
    const workerPrototype = NativeWorker.prototype;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(workerPrototype, 'constructor');
    if (constructorDescriptor && !constructorDescriptor.configurable && !constructorDescriptor.writable) {
      throw new TypeError('The plugin worker constructor cannot be guarded.');
    }
    const nativeTerminate = workerPrototype.terminate;
    const stopWorker = (worker) => {
      const timer = activeWorkers.get(worker);
      if (timer === undefined) {
        return;
      }
      activeWorkers.delete(worker);
      nativeClearTimeout(timer);
      Reflect.apply(nativeTerminate, worker, []);
    };
    const GuardedWorker = new Proxy(NativeWorker, {
      construct(target, argumentsList, newTarget) {
        if (newTarget !== GuardedWorker) {
          throw new DOMException('Plugin workers cannot be subclassed.', 'NotSupportedError');
        }
        if (activeWorkers.size >= ${pluginWorkerConcurrencyLimit}) {
          throw new DOMException('The plugin worker limit has been reached.', 'QuotaExceededError');
        }

        const worker = Reflect.construct(target, argumentsList, target);
        const timer = nativeSetTimeout(() => stopWorker(worker), ${lifetimeMs});
        activeWorkers.set(worker, timer);
        try {
          Object.defineProperty(worker, 'terminate', {
            value: () => stopWorker(worker),
            writable: false,
            configurable: false,
          });
          worker.addEventListener('error', () => stopWorker(worker), { once: true });
          worker.addEventListener('messageerror', () => stopWorker(worker), { once: true });
        }
        catch (error) {
          stopWorker(worker);
          throw error;
        }
        return worker;
      },
      getPrototypeOf() {
        return null;
      },
    });

    Object.defineProperty(workerPrototype, 'constructor', {
      value: GuardedWorker,
      writable: false,
      configurable: false,
    });
    replaceGlobalValue('Worker', GuardedWorker, true);
    replaceGlobalValue('SharedWorker', undefined, typeof globalThis.SharedWorker === 'function');

    const serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker;
    if (serviceWorker && typeof serviceWorker.register === 'function') {
      let prototype = Object.getPrototypeOf(serviceWorker);
      let registerDescriptor;
      while (prototype && !registerDescriptor) {
        registerDescriptor = Object.getOwnPropertyDescriptor(prototype, 'register');
        if (!registerDescriptor) {
          prototype = Object.getPrototypeOf(prototype);
        }
      }
      if (!prototype || !registerDescriptor || (!registerDescriptor.configurable && !registerDescriptor.writable)) {
        throw new TypeError('The plugin service worker API cannot be disabled.');
      }
      Object.defineProperty(prototype, 'register', {
        value: () => Promise.reject(new DOMException('Service workers are disabled for plugins.', 'NotAllowedError')),
        writable: false,
        configurable: false,
      });
    }

    globalThis.addEventListener?.('pagehide', () => {
      for (const worker of [...activeWorkers.keys()]) {
        stopWorker(worker);
      }
    }, { once: true });
  }
  catch {
    failClosed();
  }
})();`;
}

/**
 * Keep the signed package unchanged while making the host bootstrap run before
 * plugin code. The host response CSP replaces meta http-equiv policies so a
 * package cannot block the guard while still enabling its own workers.
 */
export function injectPluginWorkerGuard(html: string, scriptUrl: string): string {
  const withoutHttpEquiv = removeHttpEquivMetaTags(html);
  const leadingWhitespace = withoutHttpEquiv.match(/^\uFEFF?\s*/)?.[0] ?? '';
  let insertionIndex = leadingWhitespace.length;

  if (withoutHttpEquiv.slice(insertionIndex, insertionIndex + 9).toLowerCase() === '<!doctype') {
    insertionIndex = findTagEnd(withoutHttpEquiv, insertionIndex);
  }

  const script = `<script src="${scriptUrl}"></script>`;
  return `${withoutHttpEquiv.slice(0, insertionIndex)}${script}${withoutHttpEquiv.slice(insertionIndex)}`;
}

function removeHttpEquivMetaTags(html: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) {
      result += html.slice(cursor);
      break;
    }

    result += html.slice(cursor, tagStart);
    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4);
      const end = commentEnd === -1 ? html.length : commentEnd + 3;
      result += html.slice(tagStart, end);
      cursor = end;
      continue;
    }

    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === html.length && html[tagEnd - 1] !== '>') {
      result += html.slice(tagStart);
      break;
    }
    const tag = html.slice(tagStart, tagEnd);
    const tagName = getStartTagName(tag);
    if (tagName === 'meta' && hasHttpEquivAttribute(tag)) {
      cursor = tagEnd;
      continue;
    }

    result += tag;
    cursor = tagEnd;
    if (tagName && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(tagName)) {
      const closeTag = new RegExp(`<\\/${tagName}\\s*>`, 'ig');
      closeTag.lastIndex = cursor;
      const closeMatch = closeTag.exec(html);
      if (!closeMatch) {
        result += html.slice(cursor);
        break;
      }
      result += html.slice(cursor, closeMatch.index + closeMatch[0].length);
      cursor = closeMatch.index + closeMatch[0].length;
    }
  }

  return result;
}

function getStartTagName(tag: string): string | null {
  const match = /^<([a-z][a-z0-9:-]*)\b/i.exec(tag);
  return match?.[1]?.toLowerCase() ?? null;
}

function hasHttpEquivAttribute(tag: string): boolean {
  const tagName = getStartTagName(tag);
  if (tagName !== 'meta') {
    return false;
  }

  let cursor = 1 + tagName.length;
  while (cursor < tag.length) {
    while (/\s|\//.test(tag[cursor] ?? '')) {
      cursor++;
    }
    if (tag[cursor] === '>' || cursor >= tag.length) {
      return false;
    }

    const start = cursor;
    while (cursor < tag.length && !/[\s=/>]/.test(tag[cursor] ?? '')) {
      cursor++;
    }
    const name = tag.slice(start, cursor).toLowerCase();
    while (/\s/.test(tag[cursor] ?? '')) {
      cursor++;
    }
    if (name === 'http-equiv') {
      return true;
    }
    if (tag[cursor] !== '=') {
      continue;
    }

    cursor++;
    while (/\s/.test(tag[cursor] ?? '')) {
      cursor++;
    }
    const quote = tag[cursor] === '"' || tag[cursor] === '\'' ? tag[cursor++] : null;
    if (quote) {
      while (cursor < tag.length && tag[cursor] !== quote) {
        cursor++;
      }
      if (tag[cursor] === quote) {
        cursor++;
      }
    }
    else {
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor] ?? '')) {
        cursor++;
      }
    }
  }

  return false;
}

function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let cursor = start + 1; cursor < html.length; cursor++) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) {
        quote = null;
      }
    }
    else if (character === '"' || character === '\'') {
      quote = character;
    }
    else if (character === '>') {
      return cursor + 1;
    }
  }
  return html.length;
}
