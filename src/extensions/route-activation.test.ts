import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateExtensionToolRoute } from './route-activation-runtime';

const { activate } = vi.hoisted(() => ({ activate: vi.fn() }));

vi.mock('./runtime', () => ({ extensionHost: { activate } }));

describe('extension route activation', () => {
  beforeEach(() => activate.mockReset());

  it('activates only the package and tool declared by a route', async () => {
    await activateExtensionToolRoute('/json-lines-converter');
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(
      'org.it-tools.data-conversion',
      'onTool:org.it-tools.data-conversion/json-lines',
    );
  });

  it('does not activate a package for built-in routes', async () => {
    await activateExtensionToolRoute('/html-wysiwyg-editor');
    expect(activate).not.toHaveBeenCalled();
  });
});
