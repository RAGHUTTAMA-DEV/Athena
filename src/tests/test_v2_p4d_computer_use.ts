import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { ComputerController } from '../computer/computerController.js';
import { WindowsAutomationBackend } from '../computer/backend/windowsAutomationBackend.js';
import { MacOSAutomationBackend } from '../computer/backend/macosAutomationBackend.js';
import { LinuxAutomationBackend } from '../computer/backend/linuxAutomationBackend.js';
import { CapabilityRegistry, seedP4DCapabilities } from '../tools/capabilityRegistry.js';
import {
  computerInspectTool,
  computerInteractTool,
  computerManageWindowTool
} from '../tools/computerTools.js';

async function runTests() {
  console.log('=== STARTING V2 P4D: COMPUTER USE AND APPLICATION CONTROL TESTS ===\n');

  const controller = ComputerController.getInstance();

  // -----------------------------------------------------------------
  // TEST 1: Backend Resolution & Honest Per-OS Capabilities
  // -----------------------------------------------------------------
  console.log('--- TEST 1: Backend Resolution & Honest Per-OS Status ---');
  const activeBackend = controller.getBackend();

  if (process.platform === 'win32') {
    assert(
      activeBackend instanceof WindowsAutomationBackend,
      'Active backend must be WindowsAutomationBackend on win32'
    );
    assert.strictEqual(activeBackend.isSupported(), true);
  }

  // Verify macOS backend reports unsupported on win32 (Spec 71 no fakes)
  const macosBackend = new MacOSAutomationBackend();
  if (process.platform !== 'darwin') {
    assert.strictEqual(macosBackend.isSupported(), false);
    assert(
      macosBackend.getUnsupportedReason()?.includes('macOS'),
      'macOS backend must state it requires macOS'
    );
  }

  // Verify Linux backend reports unsupported on win32 (Spec 71 no fakes)
  const linuxBackend = new LinuxAutomationBackend();
  if (process.platform !== 'linux') {
    assert.strictEqual(linuxBackend.isSupported(), false);
    assert(
      linuxBackend.getUnsupportedReason()?.includes('Linux'),
      'Linux backend must state it requires Linux'
    );
  }

  console.log('✓ TEST 1 PASSED: Platform backend correctly resolved; non-host OS backends honestly report unsupported.\n');

  // -----------------------------------------------------------------
  // TEST 2: Screen Inspection & Screenshot Capture
  // -----------------------------------------------------------------
  console.log('--- TEST 2: Screen Inspection & Screenshot Capture ---');
  const screenRes = await controller.inspectScreen();
  assert(screenRes.dimensions.width > 0, 'Screen width must be positive');
  assert(screenRes.dimensions.height > 0, 'Screen height must be positive');
  console.log(`  Screen resolution: ${screenRes.dimensions.width}x${screenRes.dimensions.height}`);

  if (screenRes.screenshotPath) {
    assert(fs.existsSync(screenRes.screenshotPath), 'Desktop screenshot must exist on disk');
    const stat = fs.statSync(screenRes.screenshotPath);
    assert(stat.size > 1000, 'Screenshot file must have non-trivial size');
    console.log(`  Screenshot captured: ${screenRes.screenshotPath} (${stat.size} bytes)`);
  }

  console.log('✓ TEST 2 PASSED: Screen dimensions and desktop capture verified.\n');

  // -----------------------------------------------------------------
  // TEST 3: Window Enumeration & Discovery
  // -----------------------------------------------------------------
  console.log('--- TEST 3: Window Enumeration & Discovery ---');
  const windows = await controller.listWindows();
  assert(Array.isArray(windows), 'Window list must be an array');
  console.log(`  Discovered ${windows.length} top-level application windows`);

  if (windows.length > 0) {
    const w = windows[0];
    assert(w.id, 'Window must have an ID');
    assert(w.title !== undefined, 'Window must have a title');
    assert(w.processName, 'Window must have a processName');
    console.log(`  Sample window: [${w.processName}] "${w.title}" (PID ${w.processId})`);
  }

  console.log('✓ TEST 3 PASSED: Desktop window enumeration verified.\n');

  // -----------------------------------------------------------------
  // TEST 4: UI Automation Accessibility Tree
  // -----------------------------------------------------------------
  console.log('--- TEST 4: UI Automation Accessibility Tree ---');
  const a11yTree = await controller.getAccessibilityTree({ maxDepth: 2 });
  assert(a11yTree, 'Accessibility tree must return a root node');
  assert(a11yTree.name !== undefined, 'Accessibility node must have name');
  assert(a11yTree.role !== undefined, 'Accessibility node must have role');
  console.log(`  Root node: role="${a11yTree.role}", name="${a11yTree.name}", children=${a11yTree.children?.length || 0}`);

  console.log('✓ TEST 4 PASSED: Desktop accessibility tree extracted.\n');

  // -----------------------------------------------------------------
  // TEST 5: Input Action Execution & Audit Logging
  // -----------------------------------------------------------------
  console.log('--- TEST 5: Input Action Execution & Audit Logging ---');
  controller.clearAuditLogs();

  // Test mouse move
  const moveRes = await controller.executeAction({
    action: 'mouseMove',
    point: { x: 300, y: 300 }
  });
  assert.strictEqual(moveRes.success, true);

  // Test mouse scroll
  const scrollRes = await controller.executeAction({
    action: 'scroll',
    scrollDelta: { y: 120 }
  });
  assert.strictEqual(scrollRes.success, true);

  // Check audit log
  const logs = controller.getAuditLogs();
  assert.strictEqual(logs.length, 2, 'Must record 2 audit entries');
  assert.strictEqual(logs[0].action, 'executeAction');
  assert.strictEqual(logs[0].permitted, true);

  console.log('✓ TEST 5 PASSED: Mouse move and scroll executed; audit log recorded.\n');

  // -----------------------------------------------------------------
  // TEST 6: Permission Scopes & Policy Guard
  // -----------------------------------------------------------------
  console.log('--- TEST 6: Permission Scopes & Policy Guard ---');

  // Set restrictive scope: only allowed to interact with "SafeEditorWindow"
  controller.setPermissionScope({
    enforceScope: true,
    allowedWindowPatterns: ['SafeEditorWindow']
  });

  // Verify permission check allows matching window
  const allowedCheck = controller.checkPermission('SafeEditorWindow - document.txt', 'notepad');
  assert.strictEqual(allowedCheck.allowed, true);

  // Verify permission check blocks non-matching window
  const deniedCheck = controller.checkPermission('Finance App - Banking Portal', 'chrome');
  assert.strictEqual(deniedCheck.allowed, false);
  assert(deniedCheck.reason?.includes('not in the allowed window patterns'));

  // Attempting to focus an unauthorized window must reject with Permission Denied
  let threw = false;
  try {
    await controller.focusWindow('Finance App - Banking Portal');
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Permission Denied'));
  }
  assert(threw, 'Focusing unauthorized window must throw Permission Denied');

  // Reset scope for subsequent tests
  controller.setPermissionScope({ enforceScope: false });

  console.log('✓ TEST 6 PASSED: Unauthorized applications outside permission scope blocked by policy guard.\n');

  // -----------------------------------------------------------------
  // TEST 7 (EXIT CRITERION 1): E2E Inspect Screen -> Act -> Verify
  // -----------------------------------------------------------------
  console.log('--- TEST 7 (EXIT CRITERION 1): E2E Inspect Screen -> Act -> Verify ---');

  // 1. Inspect screen via tool
  const inspectRes: any = await computerInspectTool.execute({ action: 'screen' });
  assert.strictEqual(inspectRes.success, true);
  assert(inspectRes.dimensions.width > 0);

  // 2. Discover windows via tool
  const windowListRes: any = await computerManageWindowTool.execute({ action: 'list' });
  assert.strictEqual(windowListRes.success, true);
  assert(Array.isArray(windowListRes.windows));

  // 3. Act via tool: move mouse to target coordinate
  const interactRes: any = await computerInteractTool.execute({
    action: 'mouseMove',
    point: { x: 400, y: 400 }
  });
  assert.strictEqual(interactRes.success, true);

  // 4. Act via tool: mouse scroll
  const interactScroll: any = await computerInteractTool.execute({
    action: 'scroll',
    scrollDelta: { y: 60 }
  });
  assert.strictEqual(interactScroll.success, true);

  console.log('✓ TEST 7 PASSED: E2E inspect screen -> discover windows -> act verified through tools.\n');

  // -----------------------------------------------------------------
  // TEST 8 (EXIT CRITERION 2): Capability Registry Audit
  // -----------------------------------------------------------------
  console.log('--- TEST 8 (EXIT CRITERION 2): Capability Registry Audit ---');
  const registry = CapabilityRegistry.getInstance();
  seedP4DCapabilities(registry);

  const winCap = registry.get('computer.windows');
  assert(winCap, 'computer.windows must be registered');
  if (process.platform === 'win32') {
    assert.strictEqual(winCap.status, 'real');
  }

  const macCap = registry.get('computer.macos');
  assert(macCap, 'computer.macos must be registered');
  if (process.platform !== 'darwin') {
    assert.strictEqual(macCap.status, 'unsupported');
    assert(macCap.reason?.includes('Darwin'));
  }

  const linuxCap = registry.get('computer.linux');
  assert(linuxCap, 'computer.linux must be registered');
  if (process.platform !== 'linux') {
    assert.strictEqual(linuxCap.status, 'unsupported');
    assert(linuxCap.reason?.includes('Linux'));
  }

  const a11yCap = registry.get('computer.accessibility');
  assert(a11yCap, 'computer.accessibility must be registered');
  assert.strictEqual(a11yCap.status, 'real');

  const inputCap = registry.get('computer.input');
  assert(inputCap, 'computer.input must be registered');
  assert.strictEqual(inputCap.status, 'real');

  console.log('✓ TEST 8 PASSED: Capability registry reflects true per-OS status without faking.\n');

  console.log('=== ALL V2 P4D TESTS PASSED ===\n');
}

runTests().catch((err) => {
  console.error('P4D Test failure:', err);
  process.exit(1);
});
