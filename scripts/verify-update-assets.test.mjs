import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { verifyUpdateAssets } from './verify-update-assets.mjs';

test('validates update metadata, requires block maps, and rejects damaged assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'it-tools-update-assets-'));
  try {
    const content = Buffer.from('an installer');
    const installer = 'IT-Tools-1.0.0-win-x64.exe';
    await writeFile(join(root, installer), content);
    await writeFile(join(root, `${installer}.blockmap`), 'block map');
    await writeFile(join(root, 'latest.yml'), stringify({
      version: '1.0.0',
      files: [{ url: installer, size: content.length, sha512: createHash('sha512').update(content).digest('base64') }],
    }));
    const options = { version: '1.0.0', expectedMetadata: ['latest.yml'] };
    assert.equal(await verifyUpdateAssets(root, options), 3);
    assert.match(await readFile(join(root, 'SHA256SUMS.txt'), 'utf8'), /IT-Tools-1.0.0-win-x64.exe/);
    await rm(join(root, `${installer}.blockmap`));
    await assert.rejects(verifyUpdateAssets(root, options), /Missing differential block map/);
    await writeFile(join(root, `${installer}.blockmap`), 'block map');
    await writeFile(join(root, installer), 'damaged');
    await assert.rejects(verifyUpdateAssets(root, options), /mismatch/);
    await assert.rejects(verifyUpdateAssets(root, { ...options, version: '2.0.0' }), /Invalid version/);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
});
