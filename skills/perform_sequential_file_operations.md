```yaml
name: "Perform Workspace-Aware File Operations"
description: "Executes a sequence of file system operations (create, write, read, delete, modify, etc.) while adhering to critical security policies and maintaining awareness of file location contexts. This skill ensures that destructive actions are only performed within the designated 'active workspace' and provides a clear protocol for handling operations that fall outside this boundary."
tags: ["file management", "file operations", "workspace awareness", "security policy", "directory context", "troubleshooting", "workflow", "temporary files", "data handling"]
---
# Instructions
To perform a sequence of file operations requested by the user, while prioritizing safety and compliance with workspace security policies, follow these detailed steps:

1.  **Deconstruct the Request & Plan the Execution Sequence:**
    *   Carefully analyze the user's prompt to identify all distinct file system operations required (e.g., creating, writing, reading, modifying, moving, deleting files or directories).
    *   Determine the precise chronological order in which these operations must be executed, considering any dependencies (e.g., reading a file after it's written).
    *   Identify the target file(s) or directories, the specific content (if writing), and any other parameters for each operation.
    *   Determine the appropriate internal tool or shell command to use for each step.

2.  **Understand Directory Contexts & The Active Workspace:**
    *   Be aware that the "current directory" where commands are executed might not always be identical to Athena's "active workspace".
    *   The "active workspace" is the designated directory where Athena is permitted to perform destructive operations. The "current directory" can sometimes default to a parent directory or a different location.
    *   Always clarify the absolute path if ambiguity exists, especially after creating a file or before attempting deletion.

3.  **Execute Operations Sequentially (with Context and Policy Awareness):**
    *   Execute each operation in your planned sequence, verifying success where necessary for dependent steps.
    *   For each specific operation:

    a.  **To Create or Write to a File:**
        *   Use the appropriate command for the operating system.
        *   **Tip:** If you need the file within the active workspace, specify a path relative to or explicitly within the active workspace.
        *   *Command Template (PowerShell Example):* `New-Item -Path "filename.txt" -ItemType File -Value "Your content here"`
        *   *Command Template (Bash/CMD Example):* `echo "Your content here" > filename.txt`

    b.  **To Read File Content:**
        *   Use the appropriate command for the operating system.
        *   *Command Template (PowerShell Example):* `Get-Content -Path "filename.txt"`
        *   *Command Template (Bash/CMD Example):* `cat filename.txt`

    c.  **Before ANY Destructive Operation (Delete, Move, Overwrite, Modify): Verify File Location & Adhere to Security Policy:**
        *   **CRITICAL STEP:** *Always* explicitly confirm the file's exact, absolute location before performing any destructive operation.
        *   Do not assume a file is in the active workspace just because you recently created it.
        *   Use a directory listing command (`ls` or `dir`) in the suspected directories (including the active workspace and its parent directories) to locate the file and determine its full path.
        *   *Command Template (PowerShell Example):* `Get-ChildItem -Path "C:\Users\raghu\Documents" -Filter "canary_test.txt" -Recurse -ErrorAction SilentlyContinue` (Adjust path as needed).

        *   **CRITICAL CONSTRAINT:** Destructive file operations are *blocked* if the target file is located *outside* Athena's `active workspace`. This is enforced by the `Destructive file operation outside the active workspace is blocked` policy.
        *   **Action if file is OUTSIDE active workspace:** If the file to be deleted (or moved, overwritten, etc.) is located outside the active workspace, *do not attempt the destructive operation directly*. Clearly report the exact file path, identify your current `active workspace`, and explicitly state that the operation is blocked due to the `Destructive file operation outside the active workspace is blocked` policy. Request user guidance on how to proceed, as direct action is restricted.
        *   **Action if file is INSIDE active workspace:** If the file is confirmed to be within the active workspace, proceed with the destructive operation using the appropriate command.
        *   *Command Template (PowerShell Example - for allowed operations within workspace):* `Remove-Item -Path "filename.txt" -Force` (Use `-Force` if necessary for read-only files or to bypass prompts).
        *   *Command Template (Bash/CMD Example - for allowed operations within workspace):* `rm filename.txt`
        *   *Command Template (PowerShell Example - for allowed move/rename within workspace):* `Move-Item -Path "source.txt" -Destination "destination.txt"`
        *   *Command Template (Bash/CMD Example - for allowed move/rename within workspace):* `mv source.txt destination.txt`

4.  **Confirm Overall Completion:**
    *   Once every step in the sequence has been executed (or explicitly blocked and reported), generate a clear, concise, and user-friendly summary.
    *   This summary should confirm to the user that all requested actions were successfully performed, specifically mentioning each operation completed, or report any operations that were blocked due to policy, explaining why and what guidance was requested.

**Example Scenario from History:**
User request: "Write the text "Test content" to a file named `my_temp.txt` in the active workspace, then read the file, and then delete it."

**Internal Execution Steps:**
Assuming `active workspace` is `C:\project`:
1.  **Write:** Call `write_file("C:\project\my_temp.txt", "Test content")`.
2.  **Read:** Call `read_file("C:\project\my_temp.txt")`. (The content "Test content" would be processed internally.)
3.  **Verify Location (for Delete):**
    *   `Get-ChildItem -Path "C:\project" -Filter "my_temp.txt"` confirms `C:\project\my_temp.txt` exists.
    *   This path is *inside* the active workspace.
4.  **Delete:** Call `Remove-Item -Path "C:\project\my_temp.txt"`.

**Agent Response:**
"I have successfully written "Test content" to `my_temp.txt` within the active workspace, read its content, and then securely deleted the file."

**Example Scenario 2 (Policy Block):**
User request: "Delete the file `C:\Users\raghu\Documents\canary_test.txt`."
Assume current `active workspace` is `C:\project`.

**Internal Execution Steps:**
1.  **Verify Location (for Delete):**
    *   `Get-ChildItem -Path "C:\Users\raghu\Documents" -Filter "canary_test.txt"` confirms `C:\Users\raghu\Documents\canary_test.txt` exists.
    *   This path `C:\Users\raghu\Documents\canary_test.txt` is *outside* the `active workspace` (`C:\project`).
2.  **Destructive Operation Blocked:** The operation is blocked by policy.

**Agent Response:**
"I attempted to delete the file `C:\Users\raghu\Documents\canary_test.txt`. However, this file is located outside my current active workspace (`C:\project`). Due to the `Destructive file operation outside the active workspace is blocked` policy, I cannot proceed with its deletion. Please provide guidance on how you would like me to proceed."
```