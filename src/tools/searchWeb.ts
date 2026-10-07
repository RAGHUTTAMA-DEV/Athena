import { Tool } from '../runtime/types.js';

export const searchWebTool: Tool = {
  definition: {
    name: 'searchWeb',
    description: 'Perform a web search to find matching pages, titles, snippets, and URLs for a query.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search query to look up on the web, e.g., "Kylian Mbappe stats 2025-2026".'
        }
      },
      required: ['query']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { query: string }) => {
    try {
      let results: { title: string; url: string; snippet: string }[] = [];
      let source = 'DuckDuckGo';

      // 1. Try DuckDuckGo
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.ok && response.status !== 202) {
          const html = await response.text();
          const titleMatches = Array.from(html.matchAll(/<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
          const snippetMatches = Array.from(html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g));

          for (let i = 0; i < Math.min(titleMatches.length, 8); i++) {
            const titleMatch = titleMatches[i];
            const snippetMatch = snippetMatches[i];
            
            let rawUrl = titleMatch[1];
            if (rawUrl.includes('uddg=')) {
              const parts = rawUrl.split('uddg=');
              if (parts[1]) {
                rawUrl = decodeURIComponent(parts[1].split('&')[0]);
              }
            }
            
            const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

            results.push({ title, url: rawUrl, snippet });
          }
        }
      } catch (ddgErr) {
        console.warn('[searchWeb] DuckDuckGo search failed, falling back to Yahoo...', ddgErr);
      }

      // 2. Fallback to Yahoo Search if DuckDuckGo returned no results
      if (results.length === 0) {
        source = 'Yahoo';
        try {
          const yahooUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(args.query)}`;
          const response = await fetch(yahooUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });

          if (response.ok) {
            const html = await response.text();
            const liMatches = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g));

            for (const match of liMatches) {
              const liBlock = match[1];

              if (!liBlock.includes('algo') && !liBlock.includes('compTitle')) {
                continue;
              }

              const linkMatch = liBlock.match(/href="([^"]*r\.search\.yahoo\.com\/[^"]*RU=([^"\/&]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/);
              if (!linkMatch) {
                continue;
              }

              const encodedRealUrl = linkMatch[2];
              const realUrl = decodeURIComponent(encodedRealUrl);
              const rawTitle = linkMatch[3];

              if (realUrl.includes('yahoo.com') || realUrl.includes('yimg.com') || realUrl.includes('bing.com/aclick') || realUrl.includes('help.yahoo.com')) {
                continue;
              }

              const title = rawTitle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

              const pMatch = liBlock.match(/<p[^>]*class="[^"]*fc-dustygray[^"]*"[^>]*>([\s\S]*?)<\/p>/);
              let snippet = '';
              if (pMatch) {
                snippet = pMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              } else {
                const anchorIndex = liBlock.indexOf(linkMatch[0]);
                if (anchorIndex !== -1) {
                  const textAfter = liBlock.substring(anchorIndex + linkMatch[0].length);
                  snippet = textAfter.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                }
              }

              if (snippet.length > 200) {
                snippet = snippet.substring(0, 200) + '...';
              }

              results.push({ title, url: realUrl, snippet });
              if (results.length >= 8) break;
            }
          }
        } catch (yahooErr) {
          console.error('[searchWeb] Yahoo search fallback failed:', yahooErr);
        }
      }

      if (results.length === 0) {
        return {
          success: false,
          error: 'Search failed on all engines. No structured results could be parsed.'
        };
      }

      return { success: true, query: args.query, source, results };
    } catch (err: any) {
      return { success: false, error: `Failed to search: ${err.message}` };
    }
  }
};
