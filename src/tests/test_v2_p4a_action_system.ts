import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  LocalExecutionBackend,
  SandboxedExecutionBackend,
  FilesystemEngine,
  ProcessManager,
  SearchableToolRegistry,
  ToolDiscoveryPipeline,
  ToolExecutor
} from '../tools/index.js';
import { Tool } from '../runtime/types.js';
import { PolicyEngine } from '../security/policyEngine.js';
import { ObfuscationDetector } from '../security/obfuscationDetector.js';

const TEST_DIR = path.resolve(process.cwd(), 'scratch', 'test_p4a_action');
const SANDBOX_DIR = path.join(TEST_DIR, 'sandbox_root');
const OUTSIDE_DIR = path.join(TEST_DIR, 'outside_host');

async function setup() {
  await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
  await fs.promises.mkdir(SANDBOX_DIR, { recursive: true });
  await fs.promises.mkdir(OUTSIDE_DIR, { recursive: true });

  // Create an outside sensitive target
  await fs.promises.writeFile(path.join(OUTSIDE_DIR, 'secret_host.txt'), 'SUPER_SECRET_HOST_DATA');
  await fs.promises.writeFile(path.join(OUTSIDE_DIR, '.env'), 'AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE');

  // Create inside files
  await fs.promises.writeFile(path.join(SANDBOX_DIR, 'welcome.txt'), 'Hello Sandbox');
}

async function runTests() {
  console.log('=== STARTING V2 P4A: ACTION SYSTEM TESTS ===\n');
  await setup();

  const policyEngine = new PolicyEngine({ workspaceRoot: SANDBOX_DIR });
  const obfuscationDetector = ObfuscationDetector.getInstance();

  // =========================================================================
  // TEST 1: Obfuscation Detection Engine
  // =========================================================================
  console.log('--- TEST 1: Obfuscation Detection Engine ---');
  // 1a: Base64 shell pipe
  // "rm -rf /" in base64 is "cm0gLXJmIC8="
  const b64Cmd = 'echo cm0gLXJmIC8= | base64 -d | sh';
  const obf1 = obfuscationDetector.analyze(b64Cmd);
  assert.strictEqual(obf1.isObfuscated, true, 'Base64 pipe must be detected');
  assert.ok(obf1.techniques.includes('BASE64_SHELL_PIPE'));
  assert.ok(obf1.decodedCommand.includes('rm -rf /'), `Expected decoded "rm -rf /", got "${obf1.decodedCommand}"`);

  // 1b: PowerShell EncodedCommand
  // "rmdir /s /q C:\" in UTF-16LE base64:
  const psBuf = Buffer.from('rmdir /s /q C:\\', 'utf16le');
  const psB64 = psBuf.toString('base64');
  const psCmd = `powershell.exe -EncodedCommand ${psB64}`;
  const obf2 = obfuscationDetector.analyze(psCmd);
  assert.strictEqual(obf2.isObfuscated, true, 'PowerShell EncodedCommand must be detected');
  assert.ok(obf2.techniques.includes('POWERSHELL_ENCODED_COMMAND'));
  assert.ok(obf2.decodedCommand.includes('rmdir /s /q C:\\'));

  // 1c: Windows cmd caret evasion
  const caretCmd = 'd^e^l /f /s /q C:\\';
  const obf3 = obfuscationDetector.analyze(caretCmd);
  assert.strictEqual(obf3.isObfuscated, true, 'Caret evasion must be detected');
  assert.ok(obf3.techniques.includes('CARET_INSERTION_EVASION'));
  assert.strictEqual(obf3.decodedCommand, 'del /f /s /q C:\\');

  // 1d: Hex escape evasion
  // "\x72\x6d\x20\x2d\x72\x66\x20\x2f" -> rm -rf /
  const hexCmd = "printf '\\x72\\x6d\\x20\\x2d\\x72\\x66\\x20\\x2f' | sh";
  const obf4 = obfuscationDetector.analyze(hexCmd);
  assert.strictEqual(obf4.isObfuscated, true, 'Hex escapes must be detected');
  assert.ok(obf4.decodedCommand.includes('rm -rf /'));

  console.log('✓ TEST 1 PASSED: Obfuscation detector unmasked base64, powershell, caret, and hex evasions.\n');

  // =========================================================================
  // TEST 2 (EXIT CRITERION 1): Sandbox Escape Resilience (Adversarial Suite)
  // =========================================================================
  console.log('--- TEST 2 (EXIT CRITERION 1): Sandbox Escape Resilience ---');
  const sandbox = new SandboxedExecutionBackend({
    sandboxRoot: SANDBOX_DIR,
    customEnv: { TEST_SANDBOX_KEY: 'sandbox_allowed' }
  });
  await sandbox.start();

  // 2a: Path traversal '..' attempt
  let traversalCaught = false;
  try {
    sandbox.verifySandboxPath('../outside_host/secret_host.txt');
  } catch (err: any) {
    traversalCaught = true;
    assert.ok(err.message.includes('resolves outside sandbox root'));
  }
  assert.strictEqual(traversalCaught, true, 'Path traversal via ".." must be blocked');

  // 2b: Symlink escape attempt: symlink inside sandbox pointing outside
  const escapeSymlink = path.join(SANDBOX_DIR, 'evil_symlink');
  let symlinkCreated = false;
  try {
    fs.symlinkSync(OUTSIDE_DIR, escapeSymlink, 'dir');
    symlinkCreated = true;
  } catch {
    // Windows non-admin symlink fallback (junction or test mock)
    try {
      fs.symlinkSync(OUTSIDE_DIR, escapeSymlink, 'junction');
      symlinkCreated = true;
    } catch {}
  }

  if (symlinkCreated) {
    let symlinkEscapeCaught = false;
    try {
      sandbox.verifySandboxPath('evil_symlink/secret_host.txt');
    } catch (err: any) {
      symlinkEscapeCaught = true;
      assert.ok(err.message.includes('Symlink points') || err.message.includes('outside sandbox'));
    }
    assert.strictEqual(symlinkEscapeCaught, true, 'Symlink escaping sandbox must be detected and rejected');

    // Verify PolicyEngine also catches the symlink target
    const filePolicy = policyEngine.evaluateFileAccess(path.join(escapeSymlink, 'secret_host.txt'), 'read');
    assert.strictEqual(filePolicy.allowed, false, 'PolicyEngine must block symlink escape access');
  }

  // 2c: Obfuscated destructive commands blocked in sandbox
  const resB64 = await sandbox.execute(b64Cmd);
  assert.strictEqual(resB64.exitCode, 126, 'Obfuscated rm -rf must be blocked with exit code 126');
  assert.ok(resB64.stderr.includes('DESTRUCTIVE_COMMAND'));

  const resCaret = await sandbox.execute(caretCmd);
  assert.strictEqual(resCaret.exitCode, 126, 'Obfuscated del command must be blocked');
  assert.ok(resCaret.stderr.includes('DESTRUCTIVE_COMMAND'));

  // 2d: Sensitive credential/env reads blocked in commands
  const resCatEnv = await sandbox.execute('cat .env');
  assert.strictEqual(resCatEnv.exitCode, 126, 'Reading .env via shell must be blocked');

  // 2e: Host secrets stripped from sandbox environment
  process.env.GEMINI_API_KEY = 'REAL_GEMINI_API_KEY';
  process.env.AWS_SECRET_ACCESS_KEY = 'REAL_AWS_SECRET';
  const envTest = await sandbox.execute(process.platform === 'win32' ? 'set' : 'env');
  assert.ok(!envTest.stdout.includes('REAL_GEMINI_API_KEY'), 'Host API keys must be stripped from sandbox');
  assert.ok(!envTest.stdout.includes('REAL_AWS_SECRET'), 'Host AWS keys must be stripped from sandbox');
  delete process.env.GEMINI_API_KEY;
  delete process.env.AWS_SECRET_ACCESS_KEY;

  console.log('✓ TEST 2 PASSED (EXIT CRITERION 1): All sandbox escape attempts (symlinks, .., obfuscation, env reads) failed.\n');

  // =========================================================================
  // TEST 3 (EXIT CRITERION 2): Background Run Sandboxing
  // =========================================================================
  console.log('--- TEST 3 (EXIT CRITERION 2): Background Run Sandboxing ---');
  const executor = new ToolExecutor({
    policyEngine
  });

  const mockExecTool: Tool = {
    definition: {
      name: 'executeCommand',
      description: 'Run terminal command',
      permissions: ['cmd:exec'],
      risk: 'destructive'
    },
    execute: async (args: any) => {
      return { output: 'executed' };
    }
  };

  const mockWriteTool: Tool = {
    definition: {
      name: 'writeFile',
      description: 'Write a file',
      permissions: ['fs:write'],
      risk: 'confirm'
    },
    execute: async (args: any) => {
      return { written: true };
    }
  };

  // 3a: Background execution on LOCAL backend -> MUST BE BLOCKED
  executor.setExecutionBackend(new LocalExecutionBackend(SANDBOX_DIR));
  const bgLocalExec = await executor.execute(mockExecTool, { command: 'npm test' }, { isBackground: true });
  assert.strictEqual(bgLocalExec.success, false, 'Background command on local host backend must be denied');
  assert.strictEqual(bgLocalExec.error?.code, 'POLICY_VIOLATION');
  assert.ok(bgLocalExec.error?.message.includes('sandbox backend required'));

  const bgLocalWrite = await executor.execute(mockWriteTool, { path: 'a.txt', content: 'hi' }, { isBackground: true });
  assert.strictEqual(bgLocalWrite.success, false, 'Background write on local host backend must be denied');
  assert.strictEqual(bgLocalWrite.error?.code, 'POLICY_VIOLATION');

  // 3b: Background execution on SANDBOX backend -> MUST BE ALLOWED
  executor.setExecutionBackend(sandbox);
  const bgSandboxExec = await executor.execute(mockExecTool, { command: 'echo 42' }, { isBackground: true });
  assert.strictEqual(bgSandboxExec.success, true, 'Background command inside sandbox backend must be allowed');

  const bgSandboxWrite = await executor.execute(mockWriteTool, { path: 'safe.txt', content: 'test' }, { isBackground: true });
  assert.strictEqual(bgSandboxWrite.success, true, 'Background write inside sandbox backend must be allowed');

  console.log('✓ TEST 3 PASSED (EXIT CRITERION 2): Background runs use exec/write tools ONLY inside sandbox.\n');

  // =========================================================================
  // TEST 4 (EXIT CRITERION 3): Tool Discovery with 100+ Registered Tools
  // =========================================================================
  console.log('--- TEST 4 (EXIT CRITERION 3): Tool Discovery with 100+ Tools ---');
  const largeRegistry = new SearchableToolRegistry();

  // Create 120 synthetic tools spanning various domains
  const domains = [
    { prefix: 'github', desc: 'GitHub operations: pull requests, issues, repo management', cap: ['code', 'git'] },
    { prefix: 'slack', desc: 'Slack messaging: send direct message, channels, post updates', cap: ['chat', 'notify'] },
    { prefix: 'jira', desc: 'Jira issue tracking: create backlog ticket, sprint planning', cap: ['project'] },
    { prefix: 'docker', desc: 'Docker container management: build image, run container, compose', cap: ['container', 'devops'] },
    { prefix: 'postgres', desc: 'PostgreSQL database: query tables, run migrations, inspect schema', cap: ['db', 'sql'] },
    { prefix: 'stripe', desc: 'Stripe payments: charge customer, create invoice, refund', cap: ['billing'] },
    { prefix: 'aws', desc: 'AWS cloud: deploy lambda, upload s3 bucket, ec2 status', cap: ['cloud'] },
    { prefix: 'browser', desc: 'Web browser: navigate url, take screenshot, click button', cap: ['browser', 'net:http'] },
    { prefix: 'fs', desc: 'Filesystem: read file, write file, replace content, grep search', cap: ['fs:read', 'fs:write'] },
    { prefix: 'terminal', desc: 'Terminal process: run bash command, execute script', cap: ['cmd:exec'] }
  ];

  let toolCounter = 0;
  for (const dom of domains) {
    for (let i = 1; i <= 12; i++) {
      toolCounter++;
      const name = `${dom.prefix}_action_${i}`;
      largeRegistry.register({
        definition: {
          name,
          description: `${dom.desc} (variant ${i} for enterprise workflows)`,
          capabilities: dom.cap,
          parameters: {
            type: 'OBJECT',
            properties: {
              param1: { type: 'STRING', description: `Parameter 1 for ${name}` },
              param2: { type: 'BOOLEAN', description: `Parameter 2 for ${name}` }
            },
            required: ['param1']
          }
        },
        execute: async () => ({ success: true })
      });
    }
  }

  assert.strictEqual(largeRegistry.size(), 120, 'Registry must contain 120 registered tools');

  // Query A: Slack messaging
  const slackDiscovered = ToolDiscoveryPipeline.discover(
    largeRegistry,
    'Send a direct message on Slack to Alice about sprint progress',
    { maxTools: 8, maxPromptTokens: 2000 }
  );
  assert.ok(slackDiscovered.length <= 8, 'Discovered tools must not exceed maxTools cap');
  assert.ok(slackDiscovered.some(t => t.definition.name.startsWith('slack_')), 'Must discover slack tools');
  assert.ok(!slackDiscovered.some(t => t.definition.name.startsWith('postgres_')), 'Unrelated postgres tools must be excluded');

  // Query B: Postgres query
  const pgDiscovered = ToolDiscoveryPipeline.discover(
    largeRegistry,
    'Query the users table in PostgreSQL database to inspect registrations',
    { maxTools: 8, maxPromptTokens: 2000 }
  );
  assert.ok(pgDiscovered.some(t => t.definition.name.startsWith('postgres_')), 'Must discover postgres tools');
  assert.ok(!pgDiscovered.some(t => t.definition.name.startsWith('slack_')), 'Slack tools should not match postgres query');

  // Query C: Docker build
  const dockerDiscovered = ToolDiscoveryPipeline.discover(
    largeRegistry,
    'Build the Docker container image and deploy container',
    { maxTools: 8, maxPromptTokens: 2000 }
  );
  assert.ok(dockerDiscovered.some(t => t.definition.name.startsWith('docker_')), 'Must discover docker tools');

  // Measure prompt token size across all discoveries
  for (const set of [slackDiscovered, pgDiscovered, dockerDiscovered]) {
    const totalTokens = set.reduce((sum, t) => sum + Math.ceil(JSON.stringify(t.definition).length / 4), 0);
    assert.ok(totalTokens <= 2000, `Schema token size must remain <= 2000 tokens (was ${totalTokens})`);
  }

  console.log('✓ TEST 4 PASSED (EXIT CRITERION 3): Tool discovery accurately picked relevant tools from 120 registered tools with bounded context.\n');

  // =========================================================================
  // TEST 5: FilesystemEngine Operations (move, copy, edit, inspect, search)
  // =========================================================================
  console.log('--- TEST 5: FilesystemEngine Operations ---');
  const fsEngine = new FilesystemEngine(SANDBOX_DIR, policyEngine);

  // Write and Read
  await fsEngine.writeFile('test_doc.txt', 'Initial Content Line 1\nLine 2');
  const readRes = await fsEngine.readFile('test_doc.txt');
  assert.strictEqual(readRes.content, 'Initial Content Line 1\nLine 2');

  // Edit
  await fsEngine.editFile('test_doc.txt', {
    targetContent: 'Line 2',
    replacementContent: 'Replaced Line 2'
  });
  const editedRes = await fsEngine.readFile('test_doc.txt');
  assert.ok(editedRes.content.includes('Replaced Line 2'));

  // Copy
  await fsEngine.copyFile('test_doc.txt', 'copy_doc.txt');
  const inspectCopy = await fsEngine.inspectPath('copy_doc.txt');
  assert.strictEqual(inspectCopy.exists, true);
  assert.strictEqual(inspectCopy.isFile, true);

  // Move
  await fsEngine.moveFile('copy_doc.txt', 'moved_doc.txt');
  assert.strictEqual((await fsEngine.inspectPath('copy_doc.txt')).exists, false);
  assert.strictEqual((await fsEngine.inspectPath('moved_doc.txt')).exists, true);

  // Search
  const searchResults = await fsEngine.searchFiles('moved');
  assert.ok(searchResults.includes('moved_doc.txt'));

  // Delete
  await fsEngine.deleteFile('moved_doc.txt');
  assert.strictEqual((await fsEngine.inspectPath('moved_doc.txt')).exists, false);

  console.log('✓ TEST 5 PASSED: FilesystemEngine write, read, edit, copy, move, search, and delete verified.\n');

  // =========================================================================
  // TEST 6: ProcessManager Foreground & Background Tracking
  // =========================================================================
  console.log('--- TEST 6: ProcessManager Process Tracking & Signals ---');
  const procMgr = ProcessManager.getInstance();

  const isWin = process.platform === 'win32';
  const quickCmd = isWin ? 'echo ProcessRunning' : 'echo ProcessRunning';
  const proc = await procMgr.spawnProcess(quickCmd, { cwd: SANDBOX_DIR });
  assert.ok(proc.pid > 0);
  assert.strictEqual(proc.status, 'running');

  const finishedProc = await procMgr.waitForProcess(proc.pid, 5000);
  assert.strictEqual(finishedProc.status, 'completed');
  assert.strictEqual(finishedProc.exitCode, 0);

  const logs = procMgr.getLogs(proc.pid);
  assert.ok(logs.some(l => l.includes('ProcessRunning')));

  // Background long-running process & kill
  const sleepCmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 10"' : 'sleep 10';
  const bgProc = await procMgr.spawnProcess(sleepCmd, { cwd: SANDBOX_DIR, isBackground: true });
  assert.strictEqual(bgProc.isBackground, true);

  const killed = procMgr.killProcess(bgProc.pid, 'SIGKILL');
  assert.strictEqual(killed, true, 'Process must be killed successfully');
  assert.strictEqual(procMgr.getProcess(bgProc.pid)?.status, 'killed');

  console.log('✓ TEST 6 PASSED: ProcessManager spawn, log streaming, wait, and signal termination verified.\n');

  // Cleanup
  await sandbox.stop();
  procMgr.shutdown();
  fsEngine.closeAllWatchers();

  // On Windows, explicitly unlink junctions/symlinks before deleting parent directory
  try {
    if (fs.existsSync(escapeSymlink)) {
      fs.unlinkSync(escapeSymlink);
    }
  } catch {}

  await new Promise(r => setTimeout(r, 200));

  try {
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // Best-effort directory cleanup on Windows
  }

  console.log('=== ALL V2 P4A ACTION SYSTEM TESTS PASSED ===\n');
}

runTests().catch((err) => {
  console.error('\n❌ P4A TEST SUITE FAILED:', err);
  process.exit(1);
});
