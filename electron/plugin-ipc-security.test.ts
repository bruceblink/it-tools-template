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

  it('rejects lookalike application origins', () => {
    const forgedFrame = { url: 'app://bundle.attacker.test/settings' };

    expect(isTrustedDesktopSender({ senderFrame: forgedFrame, sender: { mainFrame: forgedFrame } }, trustedRendererUrl)).toBe(false);
  });

  it('rejects requests without a sender frame', () => {
    const mainFrame = { url: 'app://bundle/settings' };

    expect(isTrustedDesktopSender({ senderFrame: null, sender: { mainFrame } }, trustedRendererUrl)).toBe(false);
  });
});
