---
name: "Process and Summarize Multi-Part User Profile"
description: "When the user provides a detailed profile, preferences, or constraints over several turns, this skill consolidates and summarizes the information, then confirms understanding and adapts subsequent interactions based on the stated guidelines."
tags: ["user-profile", "onboarding", "memory", "summarization", "adaptation", "preferences", "constraints"]
---
# Instructions
This skill is triggered when the user provides comprehensive information about themselves, their preferences, technical stack, learning goals, or interaction style, often labeled as a "User Profile" or similar. The goal is to ingest this multi-part information, synthesize it, confirm understanding, and establish a new baseline for future interactions.

1.  **Acknowledge Profile Initiation:**
    *   When the user indicates they are starting a profile (e.g., `# User Profile`), acknowledge and prompt them to provide details.
    *   Example: "Okay, I'm ready to receive your user profile. Please provide the details."

2.  **Incrementally Process Input:**
    *   As the user provides sections of their profile (which may span multiple turns and use various markdown structures like headings, bullet points, code blocks, etc.), process each piece of information.
    *   Store this information in a temporary buffer or working memory dedicated to profile building.

3.  **Synthesize and Consolidate:**
    *   Once the user explicitly stops providing profile information or indicates completion (e.g., "remember this about this", "ok tell me about me"), or a new, unrelated query is made, trigger the consolidation step.
    *   Combine all collected profile fragments into a single, comprehensive internal representation.
    *   Identify key categories (e.g., identity, career goals, technical stack, preferences, constraints, communication style, etc.).

4.  **Generate a Comprehensive Summary:**
    *   Formulate a detailed, structured summary of the entire user profile.
    *   Organize the summary logically, using headings or bullet points to mirror the user's input structure where appropriate, but ensuring readability.
    *   Prioritize clarity and completeness. Include all significant details provided by the user.

5.  **Confirm Understanding and State Behavioral Adaptation:**
    *   Present the summary back to the user for confirmation.
    *   Explicitly state how the agent will adapt its future behavior based on the profile, especially regarding communication style, technical preferences, and problem-solving approaches.
    *   Mention specific rules derived from the profile (e.g., "I'll match your casual, direct, technically deep style," "I will ensure that any code I provide or assist with will be production-quality," "When there are options, I'll rank them, discuss pros/cons, and identify the best and production choices.").

6.  **Verify and Engage:**
    *   End with a question to confirm the accuracy of the summary and invite the user to correct any misunderstandings or add further details.
    *   Example: "Did I get that right, dude?" or "Consider this profile loaded. What's up, dude? How can I help you crush your goals today?"

**Tips & Constraints:**
*   **Contextual Sensitivity:** Be aware that profile information might include personal constraints (e.g., dietary, geographical) that are only relevant in specific contexts. Note these for conditional retrieval.
*   **Tone Matching:** If the profile specifies a preferred communication style, begin to adopt it immediately in the summary and confirmation.
*   **Actionable Insights:** Translate descriptive preferences (e.g., "prefers deep explanations") into concrete behavioral directives for the agent.
*   **Internal Storage:** Ensure the consolidated profile is stored in a retrievable manner for long-term memory and subsequent interactions, not just within the current conversation buffer.
*   **Prioritize New Information:** If a new profile is provided, it should supersede or integrate with any previous profile information, with the latest information taking precedence.