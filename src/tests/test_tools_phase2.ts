import { replaceFileContentTool } from '../tools/editFile.js';
import { readFileTool } from '../tools/readFile.js';
import { grepSearchTool } from '../tools/grepSearch.js';
import * as fs from 'fs/promises';
import * as path from 'path';

async function runPhase2ToolTests() {
  console.log('=== STARTING PHASE 2 TOOL TESTS ===\n');

  const testDir = path.resolve('./scratch/test_tools_phase2');
  await fs.mkdir(testDir, { recursive: true });
  const testFile = path.join(testDir, 'sample.txt');

  try {
    // --- TEST 1: readFile with line slicing ---
    console.log('--- TEST 1: readFile line slicing & numbering ---');
    const sampleContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: Hello World`).join('\n');
    await fs.writeFile(testFile, sampleContent, 'utf-8');

    const readSlice = await readFileTool.execute({ path: testFile, startLine: 5, endLine: 8 });
    if (!readSlice.success) throw new Error(`readFile failed: ${readSlice.error}`);
    console.log('Read slice:\n' + readSlice.content);
    if (!readSlice.content.includes('5: Line 5: Hello World') || !readSlice.content.includes('8: Line 8: Hello World')) {
      throw new Error('readFile did not return expected numbered lines.');
    }
    console.log('✓ TEST 1 PASSED: readFile line slicing works.\n');

    // --- TEST 2: replaceFileContent surgical edit ---
    console.log('--- TEST 2: replaceFileContent surgical edit ---');
    const replaceResult = await replaceFileContentTool.execute({
      path: testFile,
      targetContent: 'Line 6: Hello World',
      replacementContent: 'Line 6: Athena Agent Was Here'
    });

    if (!replaceResult.success) throw new Error(`replaceFileContent failed: ${replaceResult.error}`);
    const verifiedContent = await fs.readFile(testFile, 'utf-8');
    if (!verifiedContent.includes('Line 6: Athena Agent Was Here')) {
      throw new Error('Modified content not found in file!');
    }
    console.log('✓ TEST 2 PASSED: replaceFileContent successfully edited line.\n');

    // --- TEST 3: replaceFileContent error handling (unmatched target) ---
    console.log('--- TEST 3: replaceFileContent non-existent target ---');
    const failResult = await replaceFileContentTool.execute({
      path: testFile,
      targetContent: 'Non existent line 99999',
      replacementContent: 'Something else'
    });
    if (failResult.success) {
      throw new Error('replaceFileContent should have failed for missing target!');
    }
    console.log('✓ TEST 3 PASSED: Expected error returned: ' + failResult.error + '\n');

    // --- TEST 4: grepSearch codebase search ---
    console.log('--- TEST 4: grepSearch codebase search ---');
    const grepResult = await grepSearchTool.execute({
      query: 'Athena Agent Was Here',
      path: './scratch/test_tools_phase2'
    });

    if (!grepResult.success) throw new Error(`grepSearch failed: ${grepResult.error}`);
    console.log(`Grep matches found: ${grepResult.totalMatches}`);
    if (grepResult.totalMatches !== 1) {
      throw new Error(`Expected 1 match, got ${grepResult.totalMatches}`);
    }
    console.log(`Match line: ${grepResult.matches[0].line}, text: "${grepResult.matches[0].text}"`);
    console.log('✓ TEST 4 PASSED: grepSearch correctly found file and line number.\n');

    console.log('ALL PHASE 2 TOOL TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    // Clean up scratch test file
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runPhase2ToolTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
