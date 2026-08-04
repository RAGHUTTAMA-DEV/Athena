---
name: "Create, Verify, and Delete Temporary File"
description: "Perform a sequence of file operations to create a file with specified content, verify its content by reading, and then clean up by deleting it. Useful for testing file system interactions, temporary data storage, or demonstrating file access capabilities."
tags: ["file", "write", "read", "delete", "temporary", "verification", "filesystem"]
---
# Instructions
This skill involves a three-step workflow to manage temporary files.

1.  **Write Content to a New File:**
    *   **Action:** Create a new file and write the specified content into it.
    *   **Command Template (shell):** `echo "<content>" > <filename>`
    *   **Example:** `echo "Hello World" > test_file.txt`
    *   **Tip:** Ensure the content is properly quoted if it contains spaces or special characters.

2.  **Read the File to Verify Content:**
    *   **Action:** Read the content of the file created in the previous step to confirm it was written correctly.
    *   **Command Template (shell):** `cat <filename>`
    *   **Example:** `cat test_file.txt`
    *   **Tip:** Compare the output of the read operation with the original content you intended to write.

3.  **Delete the Temporary File:**
    *   **Action:** Remove the temporary file from the file system. This is crucial for cleanup and resource management.
    *   **Command Template (shell):** `rm <filename>`
    *   **Example:** `rm test_file.txt`
    *   **Constraint:** Ensure you have the necessary permissions to delete files in the target directory.
    *   **Tip:** Always ensure the deletion step is performed, even if previous steps encounter errors, to prevent accumulation of temporary files.