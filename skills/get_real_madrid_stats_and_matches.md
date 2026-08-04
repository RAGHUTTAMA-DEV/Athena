---
name: "get_real_madrid_stats_and_matches"
description: "Retrieves the latest match schedules, results, and key statistics for Real Madrid. This skill should be used when the user asks for Real Madrid's current season matches, past results, upcoming fixtures, or general team statistics like league position, wins, losses, and goals."
tags: ["sports", "football", "Real Madrid", "stats", "matches", "web scraping", "data extraction"]
---
# Instructions
This skill leverages web search, browsing, and Python-based data extraction to provide up-to-date information about Real Madrid.

**Workflow:**

1.  **Identify User Intent:** Recognize requests related to Real Madrid's football matches, schedules, results, or team statistics (e.g., "get Real Madrid matches," "Real Madrid league standings," "stats for Real Madrid").

2.  **Determine Specific Data Required:**
    *   If the user asks for "matches" or "schedule," focus on upcoming and recent fixtures.
    *   If the user asks for "stats," focus on league position, wins, losses, draws, goals scored/conceded, etc.
    *   Note if a specific season is requested (e.g., "this season," "2025-26 season"). If not specified, default to the current or most recent completed/upcoming season.

3.  **Formulate Web Search Query:**
    *   Construct precise `searchWeb` queries to find reliable sports data sources.
    *   **Examples:**
        *   "Real Madrid current season schedule ESPN"
        *   "Real Madrid La Liga standings"
        *   "Real Madrid match results 2026-27"
        *   "Real Madrid official website fixtures"

4.  **Execute Web Search (`searchWeb`):**
    *   Perform the search and analyze the results to identify authoritative sports news sites, official league sites, or well-known sports statistics providers (e.g., ESPN, FIFA, UEFA, La Liga official site, reputable sports news outlets). Prioritize official or widely trusted sources.

5.  **Browse Relevant URL (`browseUrl`):**
    *   Select the most promising URL from the `searchWeb` results that likely contains the requested information.
    *   Use `browseUrl` to fetch the full content of the page.

6.  **Extract Data using Python (`executePython`):**
    *   Once the HTML content is retrieved, use `executePython` to parse the content.
    *   **Techniques for Extraction:**
        *   **String manipulation:** For simpler patterns, use Python's built-in string methods (`.find()`, `.split()`, regular expressions (`re` module)).
        *   **HTML Parsing Libraries (if available in environment):** If a library like `BeautifulSoup` or `lxml` is pre-installed in the agent's Python environment, prioritize using it for robust and efficient HTML parsing. Otherwise, rely on string/regex.
    *   **Target Data Points for Matches:** Date, time, opponent, competition, home/away indicator, and result (if applicable).
    *   **Target Data Points for Stats:** League position, games played, wins, draws, losses, goals for, goals against, goal difference, points.

7.  **Format and Present Output:**
    *   Organize the extracted data into a clear, readable, and structured format.
    *   For match schedules, group by month or competition.
    *   For stats, present in a list or table format.
    *   Include the source of the information (e.g., "pulled from ESPN") for transparency.
    *   **Constraint:** If match times are listed as "TBD" (To Be Determined) or similar, explicitly state this in the output, as seen in the example.

**Tips and Constraints:**
*   **Dynamic Content:** Be aware that some websites load content dynamically with JavaScript. If direct `browseUrl` doesn't yield the desired data, try to find alternative static pages or refine search queries to target pages with more static HTML.
*   **Error Handling:** Implement checks for missing data or unexpected page structures during Python parsing. Provide a graceful fallback or inform the user if specific data cannot be found.
*   **Season Specificity:** Always try to infer the correct season from the user's query. If ambiguous, clarify with the user.
*   **Data Freshness:** Prioritize retrieving the most current data available on the web. Note the date of retrieval if the information could become quickly outdated.