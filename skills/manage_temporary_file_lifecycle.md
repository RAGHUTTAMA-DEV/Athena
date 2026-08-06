---
name: "Manage Temporary File Lifecycle"
description: "This skill allows the agent to create a temporary file with specified content, verify its contents by reading it back, and then clean up the file system by deleting it. It is useful for testing file system interactions, handling transient data storage during a task, or ensuring a clean state after operations requiring temporary files."
tags: ["file_system", "temporary_file", "cleanup", "workflow", "testing", "data_management"]
---
# Instructions
This skill involves a sequence of file system operations to create, verify, and then remove a temporary file.

**Input Parameters:**
*   `file_name`: The desired name for the temporary file (e.g., `temp_data.txt`).
*   `file_content`: The string content to be written into the temporary file.

**Steps:**

1.  **Write Content to File:**
    *   Use the `write_file` tool to create the file with the specified `file_name` and `file_content`.
    *   **Tool call example:** `write_file(file_path='<file_name>', content='<file_content>')`
    *   *Constraint:* Ensure the file path is accessible and writable.

2.  **Read and Verify File Content:**
    *   Use the `read_file` tool with the `file_name` to retrieve its content.
    *   **Tool call example:** `read_file(file_path='<file_name>')`
    *   Compare the read content with the original `file_content` to verify successful writing.
    *   *Tip:* If verification fails, log the discrepancy and consider retrying the write operation or informing the user of an issue.

3.  **Delete File:**
    *   Once the content is verified (or the purpose of the temporary file is served), use the `delete_file` tool with the `file_name` to remove it from the file system.
    *   **Tool call example:** `delete_file(file_path='<file_name>')`
    *   *Constraint:* Ensure the file exists before attempting deletion to avoid errors.

4.  **Report Outcome:**
    *   Inform the user of the successful execution of all three steps (writing, reading/verifying, and deleting the file).
    *   If any step fails, report the specific failure to the user.