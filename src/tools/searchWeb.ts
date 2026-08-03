import { Tool } from '../core/types.js';

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
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
      const response = await fetch(url, {
        headers: {
          // Provide standard browser user agent to avoid bot blocks
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Search request failed with status: ${response.status}`);
      }

      const html = await response.text();
      
      const results: { title: string; url: string; snippet: string }[] = [];
      
      // DuckDuckGo HTML results parsing logic
      // Titles are inside: <h2 class="result__title">...<a href="...">Title</a></h2>
      // Snippets are inside: <a class="result__snippet" ...>Snippet</a>
      const titleMatches = Array.from(html.matchAll(/<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
      const snippetMatches = Array.from(html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g));

      for (let i = 0; i < Math.min(titleMatches.length, 8); i++) {
        const titleMatch = titleMatches[i];
        const snippetMatch = snippetMatches[i];
        
        let rawUrl = titleMatch[1];
        // Clean URL redirection if present
        if (rawUrl.includes('uddg=')) {
          const parts = rawUrl.split('uddg=');
          if (parts[1]) {
            rawUrl = decodeURIComponent(parts[1].split('&')[0]);
          }
        }
        
        // Remove HTML tags from title and snippet
        const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        results.push({ title, url: rawUrl, snippet });
      }

      if (results.length === 0) {
        // Fallback check if classes changed
        return { 
          success: true, 
          message: 'No structured results parsed. DuckDuckGo may have updated their layout.', 
          results: [] 
        };
      }

      return { success: true, query: args.query, results };
    } catch (err: any) {
      return { success: false, error: `Failed to search: ${err.message}` };
    }
  }
};
