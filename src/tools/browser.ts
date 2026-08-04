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
    // 1. Try a lightweight fetch first to avoid launching a heavy browser instance
    try {
      const fetchResponse = await fetch(args.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000) // 10s timeout
      });

      if (fetchResponse.ok) {
        const contentType = fetchResponse.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
          const html = await fetchResponse.text();
          // Extract text content from html by stripping scripts, styles, and HTML tags
          const textContent = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (textContent.length > 300) {
            // Extract a clean title if possible
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : args.url;

            return {
              success: true,
              title,
              url: args.url,
              content: textContent.slice(0, 8000) // Truncate to keep context size reasonable
            };
          }
        }
      }
    } catch (fetchErr: any) {
      // Log a warning and proceed to Playwright fallback
      console.warn(`[browseUrl] Direct fetch failed for ${args.url}, falling back to Playwright: ${fetchErr.message}`);
    }

    // 2. Fall back to full Playwright browser navigation if fetch failed or returned minimal text
    let browser;
    try {
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add flags for concurrency stability
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
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
        content: content.slice(0, 8000)
      };
    } catch (err: any) {
      let extraInfo = '';
      if (err.message.includes('Executable doesn\'t exist')) {
        extraInfo = ' Playwright browsers are not installed. Please run "npx playwright install" to install them.';
      }
      return { success: false, error: `Failed to browse ${args.url}: ${err.message}${extraInfo}` };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          // Ignore close errors
        }
      }
    }
  }
};
