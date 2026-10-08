/**
 * Interactive Browser Tools (Athena V2 Phase 4C backward compatibility facade).
 * Delegates directly to browserTools.ts and the singleton BrowserEngine.
 */

export {
  browserNavigateTool,
  browserActionTool,
  browserTabManageTool,
  browserSessionManageTool,
  browserExtractTool,
  browserScreenshotTool
} from './browserTools.js';
