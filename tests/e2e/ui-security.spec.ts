import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the DOM boundary in Chromium itself, without a second DOM implementation.
const moduleCode = ts.transpileModule(readFileSync('src/ui/dom.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test.beforeEach(async ({ page }) => {
  await page.setContent('<!doctype html><div id="host"></div>');
  await page.addScriptTag({ content: `(() => { const exports = {}; ${moduleCode}\nwindow.__uiDom = exports; })();` });
});

test('HTML-looking text and quoted attribute values remain inert', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { html, render } = (window as any).__uiDom;
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>&lt;svg/onload=alert(3)&gt;';
    const attribute = '\" onmouseover="alert(1)" data-extra="';
    const host = document.querySelector('#host')!;
    render(host, html`<div title="${attribute}">${[html`<b>${payload}</b>`, html`<span>${'蜂群 🐱'}</span>`]}</div>`);
    return { text: host.querySelector('b')!.textContent, title: host.firstElementChild!.getAttribute('title'),
      unicode: host.querySelector('span')!.textContent, dangerous: host.querySelectorAll('img,script,svg,[onmouseover],[data-extra]').length, payload, attribute };
  });
  expect(result.text).toBe(result.payload);
  expect(result.title).toBe(result.attribute);
  expect(result.unicode).toBe('蜂群 🐱');
  expect(result.dangerous).toBe(0);
});

test('nested templates can be reused and boolean attributes keep their meaning', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { html, render } = (window as any).__uiDom;
    const host = document.querySelector('#host')!;
    const message = html`<b>${42}</b>`;
    const show = (disabled: boolean) => render(host, html`<button disabled="${disabled}">${message}</button>`);
    show(true);
    const disabled = host.querySelector('button')!.disabled;
    show(false);
    return { disabled, enabled: !host.querySelector('button')!.disabled, text: host.querySelector('b')!.textContent };
  });
  expect(result).toEqual({ disabled: true, enabled: true, text: '42' });
});

test('the markup boundary rejects executable tags, event and URL attributes, CSS injection and fabricated templates', async ({ page }) => {
  const rejected = await page.evaluate(() => {
    const { html, render } = (window as any).__uiDom;
    const host = document.querySelector('#host')!;
    const cases = [
      () => render(host, html`<script>alert(1)</script>`),
      () => render(host, html`<div onclick="alert(1)"></div>`),
      () => render(host, html`<div src="${'javascript:alert(1)'}"></div>`),
      () => render(host, html`<form action="https://evil.example"><input type="text" /></form>`),
      () => render(host, html`<button formaction="https://evil.example">submit</button>`),
      () => render(host, html`<div style="color:${'#fff;background:url(https://evil.example)'}"></div>`),
      () => html(Object.assign(['<b>', '</b>'], { raw: ['<b>', '</b>'] }), 'unsafe'),
    ];
    render(host, html`<div style="--pc:${'#f0ac52'};width:${50}%"></div>`);
    const style = host.firstElementChild!.getAttribute('style');
    return { style, rejected: cases.map(run => { try { run(); return false; } catch { return true; } }) };
  });
  expect(rejected.style).toBe('--pc:#f0ac52;width:50%');
  expect(rejected.rejected).toEqual([true, true, true, true, true, true, true]);
});

test('the built game renders toast text and boss names without HTML injection', async ({ page }) => {
  await page.route('**/api/v1/games/fire-zombie/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/?seed=0');
  await expect(page.getByTestId('start-btn')).toBeVisible();
  const result = await page.evaluate(() => {
    const ui = (window as any).__prism.ui;
    const payload = '<img src=x onerror=alert(1)>';
    ui.toast(payload, 3000);
    ui.bossWarning(payload, payload);
    return { toast: document.querySelector('.toast')!.textContent, boss: document.querySelector('.b-title')!.textContent,
      dangerous: document.querySelectorAll('img,[onerror]').length, payload };
  });
  expect(result.toast).toBe(result.payload);
  expect(result.boss).toBe(result.payload);
  expect(result.dangerous).toBe(0);
});
