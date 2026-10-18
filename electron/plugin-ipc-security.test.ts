import { describe, expect, it } from 'vitest';
import { isTrustedDesktopSender } from './plugin-ipc-security';

const trustedRendererUrl = 'app://bundle/';

describe('plugin management IPC sender validation', () => {
  it('accepts only the trusted application main frame', () => {
    const mainFrame = { url: 'app://bundle/settings' };

    expect(isTrustedDesktopSender({ senderFrame: mainFrame, sender: { mainFrame } }, trustedRendererUrl)).toBe(true);
  });

  it('rejects a trusted-origin subframe', () => {
    const mainFrame = { url: 'app://bundle/settings' };
    const childFrame = { url: 'app://bundle/settings/plugin-frame' };

    expect(isTrustedDesktopSender({ senderFrame: childFrame, sender: { mainFrame } }, trustedRendererUrl)).toBe(false);
  });

  it('rejects plugin frames and lookalike application origins', () => {
    const pluginFrame = { url: 'it-plugin://org.example.sandbox/index.html' };
    const forgedFrame = { url: 'app://bundle.attacker.test/settings' };

    expect(isTrustedDesktopSender({ senderFrame: pluginFrame, sender: { mainFrame: pluginFrame } }, trustedRendererUrl)).toBe(false);
    expect(isTrustedDesktopSender({ senderFrame: forgedFrame, sender: { mainFrame: forgedFrame } }, trustedRendererUrl)).toBe(false);
  });

  it('rejects requests without a sender frame', () => {
    const mainFrame = { url: 'app://bundle/settings' };

    expect(isTrustedDesktopSender({ senderFrame: null, sender: { mainFrame } }, trustedRendererUrl)).toBe(false);
  });
});
