import { expect, test } from '@playwright/test';

test('expedition routes, the custom track and firing range work from the title screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('expedition-btn').click();
  await expect(page.locator('.exp-svg')).toBeVisible();
  const routeLength = await page.locator('.exp-svg line').first().evaluate(line => (line as SVGLineElement).getTotalLength());
  expect(routeLength).toBeGreaterThan(0);
  await expect(page.locator('[data-exp-node]:enabled').first()).toBeVisible();
  await page.getByTestId('expedition-close').click();
  await page.getByTestId('editor-btn').click();
  await page.getByTestId('editor-preset-0').click();
  const title = await page.getByTestId('editor-title-input').inputValue();
  await page.getByTestId('editor-play-btn').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__prism.sim.getSnapshot().customTrackTitle)).toBe(title);

  await page.goto('/');
  await page.getByTestId('range-btn').click();
  await page.getByTestId('rg-nemesis-btn').click();
  await page.getByTestId('diag-bench-btn').click();
  await expect(page.getByTestId('diag-report')).toContainText('零偏差');
  await page.getByTestId('range-exit-btn').click();
  await expect(page.getByTestId('start-btn')).toBeVisible();
  expect(errors).toEqual([]);
});
