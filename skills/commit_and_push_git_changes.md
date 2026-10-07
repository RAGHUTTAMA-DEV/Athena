```yaml
name: "Automate Git Commit and Push Changes"
description: "When a user requests to commit local changes and optionally push them to a remote Git repository, this skill enables Athena to orchestrate the necessary Git commands (`git status`, `git add`, `git commit`, `git push`) using the `executeCommand` tool. This is useful for assisting users with comprehensive version control tasks, including synchronizing local changes with a remote repository, without direct file system access, by leveraging local command execution."
tags: ["git", "commit", "push", "version-control", "executeCommand", "workflow", "development"]
---
# Instructions
This skill describes the procedure for an AI agent to perform a local Git commit operation and optionally push changes to a remote repository when requested by a user, utilizing an `executeCommand` tool.

1.  **Recognize User Intent:** Identify user requests that involve committing local code changes and/or pushing them to a remote Git repository, such as "commit changes," "save and push," "update code on remote," etc.
2.  **Confirm Tool Availability:** Ensure the `executeCommand` tool is available and enabled for use. This tool is crucial for interacting with the local system's Git installation.
3.  **Identify Repository Context:**
    *   If the user specifies a particular directory (e.g., `C:\Users\raghu\Documents\Athena`), use that as the `working_directory` for all Git commands.
    *   If no directory is specified, attempt to infer it from the conversation history or prompt the user for the correct repository path.
    *   *Self-correction:* Before executing any commands, it's good practice to verify that the identified directory is indeed a Git repository (e.g., by checking for a `.git` subdirectory or running `git rev-parse --is-inside-work-tree`).
4.  **Determine Target Branch:**
    *   If the user specifies a branch (e.g., `athena-v2`), plan to commit to and potentially push from that branch.
    *   If no branch is specified, assume the currently checked-out branch or ask the user for confirmation.
5.  **Obtain Commit Message:** Before proceeding with any Git modifications, *always* prompt the user for a clear and descriptive commit message. This is essential for good version control practices.
    *   Example prompt: "What commit message would you like to use for these changes?"
6.  **Execute Git Workflow (Step-by-Step using `executeCommand`):**
    *   **Step 1: Check Current Status:**
        *   **Purpose:** To inform the user and the AI about the current state of the repository (modified, added, deleted files) before making changes. This helps prevent unintended commits.
        *   **Command:**
            ```bash
            executeCommand("git status", working_directory="<repository_path>")
            ```
        *   **Expected Output:** The output will list untracked files, modified files, etc. Parse this output to provide concise feedback to the user.
    *   **Step 2: Stage All Changes:**
        *   **Purpose:** To add all modified, new, and deleted files to the Git staging area, preparing them for the commit.
        *   **Command:**
            ```bash
            executeCommand("git add .", working_directory="<repository_path>")
            ```
        *   **Expected Output:** Typically no output on success. Report "All changes staged."
        *   *Tip:* If specific files need to be staged instead of all changes, the user should explicitly list them (e.g., `git add file1.py file2.js`). For the general 'current code' request, `git add .` is assumed.
    *   **Step 3: Commit Staged Changes:**
        *   **Purpose:** To permanently record the staged changes in the repository's history with the provided commit message.
        *   **Command:**
            ```bash
            executeCommand("git commit -m \"<commit_message>\"", working_directory="<repository_path>")
            ```
        *   **Expected Output:** A message indicating the commit hash, changed files, and lines inserted/deleted. Report "Changes committed successfully with message: '<commit_message>'."
    *   **Step 4: Push Committed Changes (if requested or inferred):**
        *   **Purpose:** To synchronize the local branch's history with its remote counterpart, sharing the committed changes.
        *   **Condition:** Only proceed with this step if the user explicitly requested to push, or if it's clearly implied by the conversation (e.g., "save and sync," "update remote"). Otherwise, prompt the user for confirmation before pushing.
        *   **Command:**
            ```bash
            executeCommand("git push", working_directory="<repository_path>")
            ```
        *   **Expected Output:** A message indicating the push was successful, often showing updated remote branches. Report "Changes pushed to remote successfully."
        *   *Tip:* Be prepared to handle potential authentication warnings (like `credential-manager-core`), merge conflicts if the remote has diverged, or non-fast-forward errors. If `git push` fails, suggest troubleshooting steps or options like `git pull --rebase` first.
7.  **Provide Comprehensive Feedback:**
    *   After each `executeCommand` call, summarize the outcome to the user.
    *   If any command fails, report the error message back to the user and suggest potential troubleshooting steps (e.g., "The commit failed. Please check for merge conflicts or unmerged paths.", "The push failed. You might need to pull changes from the remote first or resolve authentication issues.").
8.  **Final Confirmation:** Confirm the entire process (commit and push) is complete and ask if there are any further actions the user would like to take.

**Constraints:**
*   This skill assumes Git is installed and configured on the user's local system.
*   The `executeCommand` tool must have the necessary permissions to execute Git commands within the specified `working_directory`.
*   Direct access to the user's file system content (to *read* file changes) is not required for this specific skill, as `git add .` operates on the local file system directly.
*   Always prioritize user input for commit messages and branch names.
*   When pushing, ensure the user understands the implications and has given consent, especially if it's not explicitly requested initially.
```