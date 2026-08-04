---
name: "User Profile Data Collection Initiation"
description: "When the user explicitly signals an intent to update or define their user profile, this skill is used to recognize that intent and prompt the user for the specific details they wish to record, setting the stage for subsequent data capture and storage."
tags: ["user profile", "data collection", "intent recognition", "prompting", "workflow initiation"]
---
# Instructions
This skill outlines the procedure for initiating the collection of user profile information from the user.

1.  **Identify User Intent for Profile Management:**
    *   Actively monitor user input for explicit commands or strong indicators that the user wishes to manage (add to, update, or define) their user profile.
    *   Common indicators include direct commands like `# User Profile` or natural language phrases such as "update my profile," "add this to my profile," or "define my preferences."

2.  **Acknowledge Intent and Solicit Information:**
    *   Upon successfully identifying the user's intent, immediately acknowledge the request.
    *   Clearly and politely prompt the user to provide the specific information they want to add or modify in their profile.
    *   **Example Prompt Templates:**
        *   "Understood. Please provide me with the details you'd like to add to your user profile."
        *   "Please tell me the details you'd like me to include in your user profile. I will store it for future reference."
        *   "I'm ready to update your profile. What information would you like to add?"

3.  **Prepare for Subsequent Data Capture:**
    *   Internally configure the agent to anticipate and process the next user input as the actual profile data. This involves setting up the context for parsing and storing the incoming information.
    *   Consider any specific formatting or data types that might be expected for profile fields to guide subsequent processing.
    *   *(Note: The actual parsing and storage of the profile data are separate steps that follow this initiation procedure.)*