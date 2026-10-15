import { expect, test, type Page } from '@playwright/test';

const sensitiveStorageKeys = [
  'jwt-signer:secret',
  'jwt-signer:header',
  'jwt-signer:payload',
  'jwt-signer:token-to-verify',
  'jwt-signer:verification-secret',
];

const algorithmStorageKey = 'jwt-signer:algorithm';
const unrelatedStorageKey = 'jwt-signer:e2e-unrelated-setting';

async function navigateToTool(page: Page, toolName: string) {
  // Router links preserve in-app navigation without depending on startup hotkey registration.
  await page.getByRole('link', { name: toolName, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${toolName.toLowerCase().replaceAll(' ', '-')}$`));
}

async function readSignedJwt(page: Page): Promise<string> {
  const text = await page.locator('.tool-content').innerText();
  const token = text.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];

  if (!token) {
    throw new Error('The signed JWT output is missing.');
  }

  return token;
}

async function expectSensitiveInputsNotStored(page: Page) {
  const storageState = await page.evaluate((keys) => {
    return keys.map(key => ({
      inLocalStorage: localStorage.getItem(key) !== null,
      inSessionStorage: sessionStorage.getItem(key) !== null,
    }));
  }, sensitiveStorageKeys);

  expect(storageState).toEqual(sensitiveStorageKeys.map(() => ({
    inLocalStorage: false,
    inSessionStorage: false,
  })));
}

test('JWT inputs stay in memory across signing, verification, route changes, and reloads', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, 'HS384');
    }
  }, algorithmStorageKey);

  await page.goto('/jwt-signer');
  await expect(page.locator('[data-test-id="jwt-signer-memory-note"]')).toBeVisible();
  await expect(page.locator('[data-test-id="jwt-signer-storage-warning"]')).toHaveCount(0);
  await expect(page.locator('.tool-content .c-select-input').first()).toContainText('HS384');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS384"/);

  await page.getByLabel('Secret').nth(0).fill('e2e-signing-secret');
  await page.getByLabel('Header').fill('{"alg":"HS384","typ":"JWT"}');
  await page.getByLabel('Payload').fill('{"sub":"e2e-subject"}');
  const token = await readSignedJwt(page);

  await page.getByLabel('JWT', { exact: true }).fill(token);
  await page.getByLabel('Secret').nth(1).fill('e2e-signing-secret');
  await expect(page.locator('.tool-content .c-alert').last()).toContainText('Signature verified');
  await expectSensitiveInputsNotStored(page);
  const algorithmPersisted = await page.evaluate(key => localStorage.getItem(key) === 'HS384', algorithmStorageKey);
  expect(algorithmPersisted).toBe(true);

  const algorithmSelect = page.locator('.tool-content .c-select').first();
  await algorithmSelect.locator('.c-select-input').click();
  await algorithmSelect.locator('.c-select-dropdown-option').filter({ hasText: 'HS512' }).click();
  await expect(algorithmSelect.locator('.c-select-input')).toContainText('HS512');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS512"/);
  const updatedAlgorithmPersisted = await page.evaluate(key => localStorage.getItem(key) === 'HS512', algorithmStorageKey);
  expect(updatedAlgorithmPersisted).toBe(true);

  await navigateToTool(page, 'Regex Tester');
  await navigateToTool(page, 'JWT signer');
  await expect(page.getByLabel('Secret').nth(0)).not.toHaveValue('e2e-signing-secret');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS512"/);
  await expect(page.getByLabel('Payload')).not.toHaveValue('{"sub":"e2e-subject"}');
  await expect(page.getByLabel('JWT', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Secret').nth(1)).not.toHaveValue('e2e-signing-secret');
  await expectSensitiveInputsNotStored(page);

  await page.getByLabel('Secret').nth(0).fill('e2e-reload-secret');
  await page.getByLabel('Payload').fill('{"sub":"reload-subject"}');
  await page.reload();
  await expect(page.locator('.tool-content .c-select-input').first()).toContainText('HS512');
  await expect(page.getByLabel('Secret').nth(0)).not.toHaveValue('e2e-reload-secret');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS512"/);
  await expect(page.getByLabel('Payload')).not.toHaveValue('{"sub":"reload-subject"}');
  await expectSensitiveInputsNotStored(page);
  expect(pageErrors).toEqual([]);
});

test('clears only the five legacy JWT input keys and preserves preferences', async ({ page }) => {
  await page.addInitScript(({ sensitiveKeys, algorithmKey, unrelatedKey }) => {
    for (const [index, key] of sensitiveKeys.entries()) {
      localStorage.setItem(key, `legacy-test-value-${index}`);
    }
    localStorage.setItem(algorithmKey, 'HS384');
    localStorage.setItem(unrelatedKey, 'preserve-test-setting');
  }, {
    sensitiveKeys: sensitiveStorageKeys,
    algorithmKey: algorithmStorageKey,
    unrelatedKey: unrelatedStorageKey,
  });

  await page.goto('/jwt-signer');
  await expect(page.locator('[data-test-id="jwt-signer-memory-note"]')).toBeVisible();
  const storageState = await page.evaluate(({ sensitiveKeys, algorithmKey, unrelatedKey }) => ({
    sensitiveKeysRemain: sensitiveKeys.map(key => localStorage.getItem(key) !== null),
    algorithmPreserved: localStorage.getItem(algorithmKey) === 'HS384',
    unrelatedSettingPreserved: localStorage.getItem(unrelatedKey) === 'preserve-test-setting',
  }), {
    sensitiveKeys: sensitiveStorageKeys,
    algorithmKey: algorithmStorageKey,
    unrelatedKey: unrelatedStorageKey,
  });

  expect(storageState.sensitiveKeysRemain).toEqual(sensitiveStorageKeys.map(() => false));
  expect(storageState.algorithmPreserved).toBe(true);
  expect(storageState.unrelatedSettingPreserved).toBe(true);
  await expect(page.locator('[data-test-id="jwt-signer-storage-warning"]')).toHaveCount(0);
});

test('storage failures show a warning while JWT signing and verification remain available', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/regex-tester');
  await page.evaluate(({ sensitiveKeys, algorithmKey }) => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function (key) {
      if (key === algorithmKey) {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }
      return originalGetItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === algorithmKey) {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key === sensitiveKeys[0]) {
        throw new DOMException('Blocked by test storage', 'SecurityError');
      }
      return originalRemoveItem.call(this, key);
    };
  }, {
    sensitiveKeys: sensitiveStorageKeys,
    algorithmKey: algorithmStorageKey,
  });

  await navigateToTool(page, 'JWT signer');
  await expect(page.locator('[data-test-id="jwt-signer-storage-warning"]')).toBeVisible();
  await expect(page.locator('.tool-content .c-select-input').first()).toContainText('HS256');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS256"/);

  const algorithmSelect = page.locator('.tool-content .c-select').first();
  await algorithmSelect.locator('.c-select-input').click();
  await algorithmSelect.locator('.c-select-dropdown-option').filter({ hasText: 'HS512' }).click();
  await expect(algorithmSelect.locator('.c-select-input')).toContainText('HS512');
  await expect(page.getByLabel('Header')).toHaveValue(/"alg": "HS512"/);

  await page.getByLabel('Secret').nth(0).fill('e2e-storage-failure-secret');
  await page.getByLabel('Payload').fill('{"sub":"storage-failure-subject"}');
  const token = await readSignedJwt(page);
  await page.getByLabel('JWT', { exact: true }).fill(token);
  await page.getByLabel('Secret').nth(1).fill('e2e-storage-failure-secret');
  await expect(page.locator('.tool-content .c-alert').last()).toContainText('Signature verified');
  await expectSensitiveInputsNotStored(page);
  expect(pageErrors).toEqual([]);
});
