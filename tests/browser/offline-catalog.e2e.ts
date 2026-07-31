import { expect, test } from '@playwright/test';

test('scans from the local catalog while external services are unavailable', async ({ browser }) => {
  const context = await browser.newContext();
  const externalRequests: string[] = [];
  const catalogRequests: string[] = [];

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      if (url.pathname.includes('pokemon-catalog.v1-')) catalogRequests.push(url.pathname);
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort();
  });

  const page = await context.newPage();
  await page.goto('./');
  await expect(page.getByText('System Online // Pokedex Database Ready')).toBeVisible({ timeout: 30_000 });

  await page.locator('.regulation-select').selectOption('__unrestricted__');
  await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Guided Build' }).click();
  const search = page.getByRole('searchbox', { name: 'Pokemon search' });
  await search.fill('scizor');
  await page.locator('.search-results button').first().click();
  await search.fill('escavalier');
  await page.locator('.search-results button').first().click();
  await page.getByRole('button', { name: 'Find Partners' }).click();
  await expect(page.getByRole('heading', { name: 'Choose one partner' })).toBeVisible();
  await expect(page.locator('.recommendation-card')).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.recommendation-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  expect(catalogRequests).toHaveLength(1);
  expect(externalRequests.filter((url) => url.includes('pokeapi.co'))).toEqual([]);

  const cachedPage = await context.newPage();
  await cachedPage.route('**/pokemon-catalog.v1-*.js', (route) => route.abort());
  await cachedPage.goto('./');
  await expect(cachedPage.getByText('System Online // Pokedex Database Ready')).toBeVisible({ timeout: 30_000 });

  await context.close();
});
