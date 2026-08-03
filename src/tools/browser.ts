import { Tool } from '../core/types.js';
import { chromium } from 'playwright';

export const browserTool: Tool = {
  definition: {
    name: 'browseUrl',
    description: 'Fetch text content of a given URL web page using Playwright.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: 'The web page URL to navigate to, e.g. "https://example.com".'
        }
      },
      required: ['url']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { url: string }) => {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const title = await page.title();
      const content = await page.evaluate(() => {
        return document.body ? document.body.innerText : '';
      });

      return {
        success: true,
        title,
        url: args.url,
        content: content.slice(0, 8000) // Truncate to keep context size reasonable
      };
    } catch (err: any) {
      let extraInfo = '';
      if (err.message.includes('Executable doesn\'t exist')) {
        extraInfo = ' Playwright browsers are not installed. Please run "npx playwright install" to install them.';
      }
      return { success: false, error: `Failed to browse ${args.url}: ${err.message}${extraInfo}` };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
};
