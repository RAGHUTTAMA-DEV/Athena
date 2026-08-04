---
name: "Process Compound Requests"
description: "When the user provides a single prompt containing multiple distinct requests or tasks, process each request independently, gather their results, and then present a consolidated answer to the user. This skill should be used to ensure all parts of a complex instruction are addressed, rather than focusing on only one aspect."
tags: ["multi-task", "compound request", "workflow", "parallel processing", "information retrieval"]
---
# Instructions
When a user's prompt implies more than one distinct task or information retrieval request, follow these steps to ensure all parts are addressed.

1.  **Deconstruct the Prompt:**
    *   Carefully read the user's request. Look for keywords like "and," "then," "also," or multiple interrogative phrases (e.g., "what is X and how to do Y?").
    *   Break down the single compound prompt into individual, atomic tasks or questions.
    *   *Example User Prompt:* "Dude what is the files in the curr dir and seach the web for getitng a joke on new spiderman movie"
        *   *Task 1:* "what is the files in the curr dir"
        *   *Task 2:* "seach the web for getitng a joke on new spiderman movie"

2.  **Identify Tools/Actions for Each Task:**
    *   For each atomic task identified in step 1, determine the most appropriate tool, command, or internal capability to fulfill it.
    *   *Task 1 (List files):* Use a file system command (e.g., `ls` or equivalent).
    *   *Task 2 (Search web for joke):* Use a web search tool (e.g., `ddg_search`).

3.  **Execute Tasks:**
    *   Execute all identified tasks.
    *   Whenever possible and efficient, attempt to execute independent tasks concurrently or in a sequence that optimizes overall response time.
    *   Ensure that the execution of one task does not interfere with another.

4.  **Collect and Consolidate Results:**
    *   Gather the outputs or results from all executed tasks.
    *   If a task fails, note the failure but proceed with consolidating successful results.

5.  **Synthesize and Present the Consolidated Response:**
    *   Combine the individual results into a single, coherent, and comprehensive response.
    *   Clearly delineate the answers to each part of the original request, perhaps using bullet points, numbered lists, or distinct paragraphs.
    *   Ensure the tone and phrasing match the user's initial interaction if appropriate.
    *   *Constraint:* Do not omit any part of the original request from the final summary, even if a task failed (in which case, report the failure gracefully).
    *   *Tip:* Start with a friendly acknowledgement of the multi-part request if the user's tone is informal.

**Example Application:**

*   **User Input:** "Dude what is the files in the curr dir and seach the web for getitng a joke on new spiderman movie"
*   **Internal thought process:**
    *   Deconstruct: Two tasks: list files, web search for a joke.
    *   Tools: `ls` for files, `ddg_search` for web.
    *   Execute `ls` command.
    *   Execute `ddg_search` for "Spiderman movie joke".
    *   Collect output from `ls` and the joke from `ddg_search`.
    *   Synthesize: Combine both into a single markdown response.
*   **Model Output:**
    ```
    Dude, here are the files in your current directory:
    *   .env
    *   ... (full list)

    And here's a Spiderman joke for you, dude:
    Why did Spider-Man cross the road?
    ...To get to the web-site!
    ```