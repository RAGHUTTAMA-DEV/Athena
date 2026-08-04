---
name: "Temporary File Write-Read-Delete"
description: "Automate the process of writing content to a temporary file, reading it back for verification, and then cleaning up by deleting the file. This skill is useful for testing file system operations, handling ephemeral data, or validating content generation."
tags: ["file management", "temporary file", "verification", "cleanup", "workflow", "data handling"]
---
# Instructions
To perform the workflow of creating a temporary file, verifying its content, and then deleting it, follow these steps:

1.  **Determine Content and Filename:**
    *   Identify the `content` string you wish to write.
    *   Choose a unique `filename` for the temporary file. It's often good practice to use a prefix like `temp_` or `test_` for clarity.

2.  **Write the content to the temporary file:**
    *   Use the `write_file` command/tool.
    *   **Command Template:** `write_file <filename> "<content>"`
    *   **Example:** `write_file verify_temp.txt "Test content"`

3.  **Read the content back from the file for verification:**
    *   Use the `read_file` command/tool.
    *   **Command Template:** `read_file <filename>`
    *   **Example:** `read_file verify_temp.txt`
    *   **Tip:** After reading, explicitly compare the output with the original content you wrote to confirm it was written correctly.

4.  **Delete the temporary file:**
    *   Use the `delete_file` command/tool to clean up the file system.
    *   **Command Template:** `delete_file <filename>`
    *   **Example:** `delete_file verify_temp.txt`
    *   **Constraint:** Ensure the file exists before attempting to delete it, or handle potential errors if it doesn't.

**Example Multi-step Interaction:**
```
USER: Write the text "This is temporary data" to a file named my_temp_data.txt, then read the file to confirm, and finally delete it.

MODEL: 
(Agent writes the file)
(Agent reads the file, outputting "This is temporary data")
(Agent deletes the file)
I have successfully written "This is temporary data" to `my_temp_data.txt`, read its content, and then deleted the file.
```