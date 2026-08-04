---
name: "Process Detailed User Profile"
description: "When a user provides a comprehensive, multi-section user profile (which may span multiple turns), synthesize the information into a coherent internal understanding and reflect it back to confirm accuracy, adhering to any specified communication styles and preferences. This skill ensures the agent has a robust contextual understanding of the user for future interactions."
tags: ["user profile", "context", "onboarding", "personalization", "information extraction", "synthesis", "setup", "preferences"]
---
# Instructions
This skill is critical for establishing a deep and accurate understanding of the user's identity, preferences, goals, and working environment. Follow these steps meticulously:

1.  **Detect User Profile Intent:**
    *   Look for explicit indicators such as headings like `# User Profile`, `# Preferences`, `# Constraints`, `# Agent Expectations`, or similar structured data being provided by the user.
    *   Note that a comprehensive profile may be delivered across several consecutive user messages. Acknowledge each part as it comes in, but internally understand that a larger profile is being constructed.

2.  **Identify and Categorize Information:**
    *   As the user provides details, mentally or internally categorize the information. Common categories include:
        *   **Identity & Background:** Name, Age, Location, Education, Career Stage.
        *   **Primary Goals:** Short-term, Long-term career objectives, specific project aims.
        *   **Core Interests:** Technical areas, project types, learning priorities.
        *   **Technical Stack/Skills:** Preferred languages, frameworks, databases, tools, cloud providers, infrastructure. Differentiate between "comfortable with," "learning," and "avoid."
        *   **Development Environment:** OS, Editor, commonly used local tools (e.g., Ollama, Docker).
        *   **Coding/Project Preferences:** Desired code quality, architecture principles (e.g., SOLID, modular), project scale (e.g., production-grade vs. tutorials).
        *   **Explanation/Response Style:** How the user prefers information to be delivered (e.g., deep explanations, architecture diagrams, tradeoffs, step-by-step, casual tone, directness, ranking options).
        *   **Constraints/Avoidances:** Specific things to avoid or personal constraints (e.g., dietary restrictions, topics to avoid).
        *   **Current Focus:** Active projects, technologies being heavily worked on.

3.  **Consolidate Information Across Turns:**
    *   If the profile is provided in multiple separate messages, carefully combine all relevant pieces of information. Each new piece of information should refine or add to the existing understanding of the user profile.

4.  **Extract Key Details and Instructions:**
    *   For each identified category, extract the most important facts, keywords, explicit preferences, priorities, and direct instructions (e.g., "Think like a Staff Engineer," "Always prefer X architecture"). Pay special attention to "things to avoid."

5.  **Synthesize into Internal Context:**
    *   Formulate a cohesive, comprehensive internal representation of the user's profile. This should be more than a list; it should be an integrated understanding that guides future interactions.
    *   Translate implicit instructions into actionable guidelines (e.g., "desires production-quality code" means code examples should be robust, not just illustrative).
    *   Integrate communication style preferences into the agent's persona for this user.

6.  **Formulate a Confirmation Response:**
    *   Generate a detailed summary of the profile *from the agent's perspective*, reflecting back what has been understood. This serves to confirm accuracy and demonstrate thorough processing.
    *   **Structure:**
        *   Start with a clear acknowledgement that the profile has been processed.
        *   Organize the summary logically, perhaps by the categories identified in step 2.
        *   Highlight key preferences, goals, and specific instructions (e.g., "Your priorities are...", "You want deep explanations...").
        *   Explicitly mention any specified communication style adaptation.
    *   **Content:** Ensure all critical details extracted are included. Avoid generic phrasing; use specific terms and preferences the user provided.
    *   **Tone:** Crucially, adopt any specified communication style (e.g., if the user asked for a casual tone, use it throughout the summary).
    *   **Verification:** End the summary with a direct question to the user asking for confirmation that the understanding is correct (e.g., "Did I get that right, dude?" or "Have I captured everything accurately?").

7.  **Store and Apply Context:**
    *   Ensure the consolidated and confirmed user profile is stored in the agent's long-term and active working memory. This profile should then inform all subsequent interactions, tailoring responses, recommendations, and problem-solving approaches to the user's specific needs and preferences.
    *   **Self-Correction:** If the user provides corrections or additions after the confirmation, update the stored profile immediately.

**Tips & Constraints:**
*   **Prioritize Understanding:** The primary goal is to *understand* the user deeply, not just to parrot back information.
*   **Actionable Insights:** Translate passive information into actionable guidelines for your own behavior.
*   **Maintain Consistency:** Once the profile is set, consistently apply its rules and preferences in all future interactions with that user.
*   **Be Proactive:** If the profile is incomplete but implies the need for certain information, consider asking clarifying questions (e.g., "You mentioned preferring cloud, do you have a specific provider in mind?").
---