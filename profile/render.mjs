import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from './data.mjs';
import { cards, readme } from './cards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const types = { '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ttf':'font/ttf' };

export async function renderProfile(data, destination = root) {
  const components = cards(data);
  await mkdir(destination, {recursive:true});
  const stage = await mkdtemp(path.join(destination,'.render-'));
  const files = [];
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true});
    const page = await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:2});
    // One local origin for the artwork and fonts, including when rendering offline.
    await page.route('https://cabinet.invalid/**', async route => {
      const requestPath = new URL(route.request().url()).pathname.slice(1);
      if (!requestPath) return route.fulfill({contentType:'text/html',
        body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="cards.css"><body></body>'});
      if (requestPath !== 'cards.css' && !/^art\/[\w.-]+$/.test(requestPath)) return route.abort();
      await route.fulfill({contentType:types[path.extname(requestPath)],body:await readFile(path.join(here,requestPath))});
    });
    await page.goto('https://cabinet.invalid/');
    for (const card of components) {
      for (const mobile of card.mobile ? [false,true] : [false]) {
        const html = `<article class="paper ${card.className}${mobile?' mob':''}">${card.html(mobile)}</article>`;
        await page.evaluate(async markup => {
          document.body.innerHTML=markup;
          await Promise.all(Array.from(document.images, image=>image.decode()));
          document.body.getBoundingClientRect();
          await document.fonts.ready;
        },html);
        const name = card.id+(mobile?'-mobile':'')+'.png';
        await page.locator('article').screenshot({path:path.join(stage,name)});
        files.push(name);
      }
    }
    await writeFile(path.join(stage,'README.md'),readme(components));
    const assets = path.join(destination,'assets');
    await mkdir(assets,{recursive:true});
    for (const name of files) await rename(path.join(stage,name),path.join(assets,name));
    await rename(path.join(stage,'README.md'),path.join(destination,'README.md'));
  } finally {
    await browser?.close();
    await rm(stage,{recursive:true,force:true});
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  await renderProfile(loadData());
}
