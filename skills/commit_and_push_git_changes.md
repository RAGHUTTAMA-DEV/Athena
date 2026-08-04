---
name: "Commit and Push Git Changes"
description: "When the agent needs to save current changes in the local repository, create a new commit with a specified message, and then push these changes to the remote GitHub repository. This skill is useful for maintaining version control and sharing code updates."
tags: ["git", "version control", "commit", "push", "github", "development"]
---
# Instructions
This skill automates the standard Git workflow of staging changes, committing them with a descriptive message, and pushing them to a remote repository.

1.  **Identify the current working directory as a Git repository:**
    *   Verify that the current directory is the root of an active Git repository. If not, navigate to the correct directory.

2.  **Stage all current changes:**
    *   To include all modified and new files in the commit, execute the command:
        ```bash
        git add .
        ```
    *   *Tip:* If specific files need to be staged instead of all changes, the user should explicitly list them (e.g., `git add file1.py file2.js`). For the general 'current code' request, `git add .` is assumed.

3.  **Commit the staged changes with the provided message:**
    *   Use the commit message specified by the user to create the commit:
        ```bash
        git commit -m "Your commit message here"
        ```
    *   *Constraint:* A commit message is mandatory. If the user does not provide one explicitly, the agent should prompt for one or generate a generic one (e.g., "Automated commit").

4.  **Push the committed changes to the remote repository:**
    *   Execute the push command to synchronize the local branch with its remote counterpart (typically `origin main` or `origin master`):
        ```bash
        git push
        ```
    *   *Tip:* Be prepared to handle potential authentication warnings (like `credential-manager-core`) or basic merge conflicts if the remote has diverged, although this skill primarily focuses on the successful push workflow. Confirm the push completed successfully by checking the terminal output.