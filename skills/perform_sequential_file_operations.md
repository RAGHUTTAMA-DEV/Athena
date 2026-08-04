---
name: "Perform Sequential File Operations"
description: "Use this skill when a user requests multiple file system operations (e.g., create, write, read, modify, delete) to be performed in a specific sequence. This skill ensures each step is completed before proceeding to the next, verifying a multi-stage file workflow or handling temporary files."
tags: ["file management", "file operations", "workflow", "temporary files", "data handling"]
---
# Instructions
To perform a sequence of file operations requested by the user, follow these detailed steps:

1.  **Deconstruct the Request:**
    *   Carefully analyze the user's prompt to identify all distinct file system operations. Examples include:
        *   Writing content to a file.
        *   Reading content from a file.
        *   Creating an empty file.
        *   Modifying an existing file.
        *   Deleting a file or directory.
    *   Determine the precise chronological order in which these operations must be executed.
    *   Identify the target file(s) or directories, the specific content (if writing), or other parameters for each operation.

2.  **Plan the Execution Sequence:**
    *   For each identified operation, determine the appropriate internal tool or shell command to use.
        *   **To write content to a file:** Utilize `write_file(path, content)` or a shell command like `echo "content" > path`.
        *   **To read content from a file:** Utilize `read_file(path)` or a shell command like `cat path`.
        *   **To delete a file:** Utilize `delete_file(path)` or a shell command like `rm path`.
        *   **To create a directory:** Utilize `create_directory(path)` or a shell command like `mkdir path`.
        *   **To move/rename a file:** Utilize `move_file(source_path, destination_path)` or a shell command like `mv source_path destination_path`.
    *   Prioritize dependencies: Ensure that operations that rely on the successful completion of a previous step (e.g., reading a file that was just written, or deleting a file after its content has been processed) are correctly ordered in your internal execution plan.

3.  **Execute Operations Sequentially:**
    *   Execute the very first operation in your planned sequence.
    *   Whenever possible and necessary for dependent steps, verify the success of each operation before moving to the next. This could involve checking return codes or internal status.
    *   Proceed to execute the next operation in the sequence.
    *   Repeat this process until all identified operations have been successfully completed.

4.  **Confirm Overall Completion:**
    *   Once every step in the sequence has been executed, generate a clear, concise, and user-friendly summary.
    *   This summary should confirm to the user that all requested actions were successfully performed, specifically mentioning each operation completed.

**Example Scenario from History:**
User request: "Write the text "Test content" to a file named verify_temp.txt, then read the file, and then delete it."

**Internal Execution Steps:**
1.  **Write:** Call `write_file("verify_temp.txt", "Test content")`.
2.  **Read:** Call `read_file("verify_temp.txt")`. (The content would be processed internally if needed.)
3.  **Delete:** Call `delete_file("verify_temp.txt")`.

**Agent Response:**
"I have successfully written "Test content" to `verify_temp.txt`, read its content, and then deleted the file."