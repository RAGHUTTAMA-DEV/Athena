---
name: "Compare Two Entities' Performance"
description: "When a user requests a comparison between two distinct entities (e.g., teams, companies, individuals) based on their performance or activity in a specific domain (e.g., transfer market, financial quarter, project progress), especially when the request implies independent information gathering for each."
tags: ["comparison", "multi-entity", "performance analysis", "information synthesis", "structured output"]
---
# Instructions
This skill enables the agent to effectively compare two entities by gathering information on each independently and then synthesizing a comparative analysis.

1.  **Identify the two primary entities** that the user wants to compare.
    *   *Example:* Real Madrid and Barcelona.
2.  **Determine the specific context or domain** for the comparison. This defines what aspects of their 'performance' or 'activity' should be analyzed.
    *   *Example:* "Performance in this transfer market."
3.  **Independently gather comprehensive, relevant information for each entity** within the specified context.
    *   Treat the information gathering for each entity as a separate, concurrent task.
    *   *Tip:* Access the latest available data, news, or internal knowledge base for each entity.
4.  **Summarize the findings for each entity separately.**
    *   Present key metrics, actions, or outcomes for Entity A.
    *   Present key metrics, actions, or outcomes for Entity B.
    *   Ensure these summaries are concise but cover all pertinent details for the comparison.
    *   *Constraint:* Avoid drawing comparisons or making judgments during this initial summary phase. Focus purely on presenting the facts for each.
5.  **Perform a direct comparison and provide a verdict.**
    *   Create a dedicated "Comparison and Verdict" section.
    *   Highlight key similarities and differences between the two entities' performance in the specified context.
    *   Analyze their strengths, weaknesses, or strategic approaches relative to each other.
    *   Conclude with an overall assessment or verdict based on the available information and the user's implied criteria.
    *   *Tip:* Use comparative language (e.g., "while X did this, Y did that," "X's strategy was more focused on..., whereas Y prioritized...").
6.  **Format the output clearly** with distinct sections for each entity's summary and a final comparison section, using headings for readability.