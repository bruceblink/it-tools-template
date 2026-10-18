import { expect, test } from '@playwright/test';

test.describe('Tool - JSON to TOML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/json-to-toml');
  });

  test('Has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('JSON to TOML - IT Tools');
  });

  test('JSON is parsed and outputs clean TOML', async ({ page }) => {
    await page.getByTestId('input').fill(`
{
   "foo": "bar",
   "list": {
      "name": "item",
      "another": {
         "key": "value"
      }
   }
}
    `.trim());

    const output = page.getByTestId('area-content');
    await expect(output).toContainText('foo = "bar"');
    const generatedJson = await output.innerText();

    expect(generatedJson.trim()).toEqual(
      `
foo = "bar"

[list]
name = "item"

  [list.another]
  key = "value"
   `.trim(),
    );
  });
});
