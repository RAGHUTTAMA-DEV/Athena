---
name: "Manage Temporary File Lifecycle"
description: "This skill allows the agent to create a temporary file with specified content, read its content for verification, and then delete it, ensuring proper file system cleanup. It's useful for testing file system access, temporary data storage, or short-term inter-process communication via files."
tags: ["file management", "temporary file", "filesystem", "cleanup", "verification"]
---
# Instructions
This skill performs a sequence of file system operations to manage the lifecycle of a temporary file.

1.  **Create the Temporary File:**
    *   Determine a unique filename for the temporary file (e.g., `temp_data_YYYYMMDD_HHMMSS.txt`).
    *   Write the desired content to this file.
    *   **Tip:** If no specific content is provided, an empty string or a default placeholder can be used.
    *   **Command Template (Shell):** `echo "YOUR_CONTENT" > YOUR_FILENAME.txt`
    *   **Command Template (Internal Tool):** `write_file(filename="YOUR_FILENAME.txt", content="YOUR_CONTENT")`

2.  **Verify File Content (Optional but Recommended):**
    *   Read the content back from the newly created file to confirm that the write operation was successful and the content is as expected.
    *   **Constraint:** Compare the read content with the original content provided in step 1. If they do not match, an error should be reported.
    *   **Command Template (Shell):** `cat YOUR_FILENAME.txt`
    *   **Command Template (Internal Tool):** `read_file(filename="YOUR_FILENAME.txt")`

3.  **Delete the Temporary File:**
    *   Remove the file from the filesystem to ensure proper cleanup and prevent resource accumulation.
    *   **Constraint:** This step should always be executed, even if errors occurred during creation or verification, unless a specific instruction to keep the file for debugging is given.
    *   **Command Template (Shell):** `rm YOUR_FILENAME.txt`
    *   **Command Template (Internal Tool):** `delete_file(filename="YOUR_FILENAME.txt")`

**Example Workflow:**
To write "Hello World" to `test.tmp`, read it, then delete it:
1.  `write_file(filename="test.tmp", content="Hello World")`
2.  `read_file(filename="test.tmp")` (Verify output is "Hello World")
3.  `delete_file(filename="test.tmp")`