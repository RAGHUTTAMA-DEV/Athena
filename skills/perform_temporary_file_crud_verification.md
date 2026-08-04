---
name: "Perform Temporary File CRUD Verification"
description: "When there is a need to verify file system write, read, and delete operations, or to handle temporary data with guaranteed cleanup. This skill ensures data can be written to a file, retrieved, and then removed from the system, confirming file system access and integrity."
tags: ["file system", "file operations", "temporary files", "verification", "cleanup", "CRUD", "diagnostics"]
---
# Instructions
This skill outlines the process for performing a sequence of file operations: creating a temporary file, writing data to it, reading data from it, and finally deleting it. This is useful for testing file system access, verifying data persistence, or handling transient data within the agent's environment.

## Step-by-Step Procedure:

1.  **Define temporary file parameters:**
    *   **Content:** Decide on the text or data you want to write to the temporary file. This content will be used to verify both write and read operations.
    *   **Filename:** Choose a unique and descriptive name for the temporary file. It is good practice to use a `.tmp` extension or a specific prefix like `temp_verify_` to clearly identify it as a temporary file.
    *   **Example:** For content `"Test content"` and filename `"verify_temp.txt"`.

2.  **Write content to the temporary file:**
    *   Use the appropriate file writing tool or shell command available to create the file and populate it with the defined content.
    *   **Tool/Command Template:** `echo "[[CONTENT]]" > [[FILENAME]]`
    *   **Example (Shell Command):** `echo "Test content" > verify_temp.txt`

3.  **Read content from the temporary file:**
    *   Use the appropriate file reading tool or shell command to retrieve the content from the newly created file.
    *   **Tool/Command Template:** `cat [[FILENAME]]`
    *   **Example (Shell Command):** `cat verify_temp.txt`
    *   **Verification Tip:** Compare the output of this step with the original content you intended to write. If they match, the write and read operations were successful. This confirms that the file system is functioning as expected for both writing and reading.

4.  **Delete the temporary file:**
    *   Use the appropriate file deletion tool or shell command to remove the temporary file from the file system. This ensures proper cleanup and prevents unnecessary clutter or resource consumption.
    *   **Tool/Command Template:** `rm [[FILENAME]]`
    *   **Example (Shell Command):** `rm verify_temp.txt`
    *   **Verification Tip (Optional):** After deletion, you can attempt to read the file again (`cat [[FILENAME]]`). It should result in an error indicating that the file does not exist, thereby confirming successful deletion.

## Constraints & Considerations:

*   **Permissions:** Ensure Athena has the necessary file system permissions (write, read, delete) in the target directory where the temporary file is to be created.
*   **Filename Uniqueness:** Choose temporary filenames that are unlikely to conflict with existing or critical files. If repeatedly using this skill, consider timestamping or randomizing filenames.
*   **Error Handling:** Be prepared to handle potential errors at each step (e.g., permission denied, disk full, file not found) and report them appropriately.
*   **Purpose:** This procedure is robust for verifying basic file system functionality and confirming Athena's ability to interact with the local file system.