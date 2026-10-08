import * as fs from 'fs/promises';
import * as path from 'path';
import { openDatabase } from '../storage/database.js';
import { createSqliteStores } from '../storage/stores/sqlite/index.js';
import { CapabilityRegistry, seedP9Capabilities } from '../tools/capabilityRegistry.js';
import { EpisodicMemory } from '../memory/memory.js';
import { Agent } from '../runtime/agent.js';
import {
  MultiModalEngine,
  MockVisionProvider,
  MockSTTProvider,
  SynthesizedTTSProvider,
  MockImageGenProvider,
  createValidPcmWav,
  MINIMAL_VALID_PNG
} from '../multimodal/index.js';
import {
  imageInspectTool,
  imageGenerateTool,
  voiceTranscribeTool,
  voiceSpeakTool,
  voiceGoalCreateTool
} from '../tools/multimodalTools.js';

const TEST_DB_PATH = path.resolve('./scratch/test_v2p9_multimodal.db');
const TEST_SCRATCH_DIR = path.resolve('./scratch/test_v2p9_artifacts');

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_DB_PATH, { force: true });
    await fs.rm(`${TEST_DB_PATH}-wal`, { force: true });
    await fs.rm(`${TEST_DB_PATH}-shm`, { force: true });
    await fs.rm(TEST_SCRATCH_DIR, { recursive: true, force: true });
  } catch {}
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests(): Promise<void> {
  console.log('=== STARTING V2 P9: MULTIMODAL AND VOICE SUBSYSTEM TESTS ===\n');
  await cleanup();
  await fs.mkdir(TEST_SCRATCH_DIR, { recursive: true });

  const db = await openDatabase(TEST_DB_PATH);
  const stores = createSqliteStores(db);

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration 11 & Multimodal Store CRUD
    // -------------------------------------------------------------
    console.log('--- TEST 1: Schema Migration 11 & Multimodal Store CRUD ---');

    const artifact1 = await stores.multimodal.saveArtifact({
      id: 'art_img_001',
      mediaType: 'image',
      mimeType: 'image/png',
      filePath: '/path/to/test.png',
      source: 'screenshot',
      caption: 'Main dashboard view with login button',
      metadata: { width: 1920, height: 1080 },
      createdAt: Date.now()
    });

    assert(artifact1.id === 'art_img_001', 'Artifact ID should match');
    assert(artifact1.mediaType === 'image', 'Media type should be image');

    const fetched = await stores.multimodal.getArtifact('art_img_001');
    assert(fetched !== null, 'Fetched artifact should not be null');
    assert(fetched!.mimeType === 'image/png', 'Mime type should match');
    assert(fetched!.metadata?.width === 1920, 'Metadata width should match');

    // List artifacts
    const list = await stores.multimodal.listArtifacts({ mediaType: 'image' });
    assert(list.length === 1, 'Should find 1 image artifact');

    // Delete artifact
    const deleted = await stores.multimodal.deleteArtifact('art_img_001');
    assert(deleted === true, 'Delete should return true');
    const afterDelete = await stores.multimodal.getArtifact('art_img_001');
    assert(afterDelete === null, 'Artifact should be null after delete');
    console.log('✓ TEST 1 PASSED: Migration 11 and MultimodalStore CRUD verified.\n');

    // -------------------------------------------------------------
    // TEST 2: Vision Provider Analysis & UI Elements
    // -------------------------------------------------------------
    console.log('--- TEST 2: Vision Provider Analysis & UI Elements ---');

    const visionProvider = new MockVisionProvider();
    const visionRes = await visionProvider.analyzeImage(MINIMAL_VALID_PNG, 'Detect buttons and errors');

    assert(visionRes.description.length > 0, 'Description should be populated');
    assert(Array.isArray(visionRes.labels), 'Labels should be an array');
    assert(visionRes.labels!.includes('screenshot'), 'Labels should include screenshot');
    assert(Array.isArray(visionRes.uiElements), 'uiElements should be an array');
    assert(visionRes.uiElements!.length > 0, 'Should detect at least 1 UI element');
    assert(visionRes.uiElements![0].label === 'Submit Button', 'First element should be Submit Button');

    const textDetected = await visionProvider.detectText(MINIMAL_VALID_PNG);
    assert(textDetected.includes('Login Dashboard'), 'Detected text should include Login Dashboard');
    console.log('✓ TEST 2 PASSED: Vision analysis and UI detection verified.\n');

    // -------------------------------------------------------------
    // TEST 3: Speech-to-Text (STT) Provider
    // -------------------------------------------------------------
    console.log('--- TEST 3: Speech-to-Text (STT) Provider ---');

    const mockWav = createValidPcmWav(2, 16000, 440);
    const sttProvider = new MockSTTProvider('Deploy application to production cluster');

    const transcript = await sttProvider.transcribe(mockWav, { language: 'en' });
    assert(transcript.text === 'Deploy application to production cluster', 'Transcript text should match');
    assert(transcript.confidence! >= 0.9, 'Confidence should be >= 0.9');
    assert(transcript.durationSeconds! > 0, 'Duration should be positive');
    assert(Array.isArray(transcript.segments), 'Segments should be an array');
    console.log('✓ TEST 3 PASSED: Speech-to-text transcription verified.\n');

    // -------------------------------------------------------------
    // TEST 4: Text-to-Speech (TTS) Provider with Valid PCM WAV
    // -------------------------------------------------------------
    console.log('--- TEST 4: Text-to-Speech (TTS) Provider ---');

    const ttsProvider = new SynthesizedTTSProvider();
    const synthRes = await ttsProvider.synthesize('Security review completed successfully.', { speed: 1.0 });

    assert(synthRes.mimeType === 'audio/wav', 'Mime type should be audio/wav');
    assert(synthRes.durationSeconds! > 0, 'Duration should be positive');
    assert(synthRes.audioBuffer.length > 44, 'Audio buffer should exceed WAV header size');

    // Verify WAV RIFF header
    const riff = synthRes.audioBuffer.toString('ascii', 0, 4);
    const wave = synthRes.audioBuffer.toString('ascii', 8, 12);
    assert(riff === 'RIFF', 'WAV buffer must start with RIFF');
    assert(wave === 'WAVE', 'WAV format must be WAVE');
    console.log('✓ TEST 4 PASSED: Text-to-speech audio synthesis with valid WAV verified.\n');

    // -------------------------------------------------------------
    // TEST 5: Image Generation Provider
    // -------------------------------------------------------------
    console.log('--- TEST 5: Image Generation Provider ---');

    const imageGenProvider = new MockImageGenProvider();
    const genRes = await imageGenProvider.generateImage('Modern cloud infrastructure architecture diagram', {
      width: 1024,
      height: 768
    });

    assert(genRes.mimeType === 'image/png', 'Mime type should be image/png');
    assert(genRes.width === 1024, 'Width should be 1024');
    assert(genRes.height === 768, 'Height should be 768');
    // Check PNG signature: 89 50 4E 47
    assert(genRes.imageBuffer[0] === 0x89 && genRes.imageBuffer[1] === 0x50, 'PNG magic header verified');
    console.log('✓ TEST 5 PASSED: Image generation provider verified.\n');

    // -------------------------------------------------------------
    // TEST 6: MultiModalEngine Orchestration & Artifact Persistence
    // -------------------------------------------------------------
    console.log('--- TEST 6: MultiModalEngine Orchestration & Artifact Persistence ---');

    const engine = new MultiModalEngine({
      store: stores.multimodal,
      visionProvider: new MockVisionProvider(),
      sttProvider: new MockSTTProvider(),
      imageGenProvider: new MockImageGenProvider(),
      storageDir: TEST_SCRATCH_DIR
    });

    // 6a. Analyze image & check artifact
    const analysisWithArt = await engine.analyzeImage(MINIMAL_VALID_PNG, 'Inspect header');
    assert(analysisWithArt.artifact !== undefined, 'Artifact should be saved to store');
    assert(analysisWithArt.artifact!.mediaType === 'image', 'Artifact media type should be image');

    // 6b. Transcribe audio & check artifact
    const transWithArt = await engine.transcribeAudio(mockWav, { prompt: 'override: Review open PRs' });
    assert(transWithArt.text === 'Review open PRs', 'Transcript should match override');
    assert(transWithArt.artifact !== undefined, 'Audio artifact should be saved');
    assert(transWithArt.artifact!.mediaType === 'audio', 'Artifact media type should be audio');

    // 6c. Synthesize speech & check artifact
    const synthWithArt = await engine.synthesizeSpeech('Voice response synthesized');
    assert(synthWithArt.artifact !== undefined, 'TTS artifact should be saved');
    assert(await fs.stat(synthWithArt.filePath!).then(() => true).catch(() => false), 'TTS file must exist on disk');

    // 6d. Generate image & check artifact
    const imgGenWithArt = await engine.generateImage('Project Roadmap 2026');
    assert(imgGenWithArt.artifact !== undefined, 'Generated image artifact should be saved');
    assert(await fs.stat(imgGenWithArt.filePath!).then(() => true).catch(() => false), 'Generated image must exist on disk');
    console.log('✓ TEST 6 PASSED: MultiModalEngine orchestration and artifact persistence verified.\n');

    // -------------------------------------------------------------
    // TEST 7: Multimodal Tools Execution
    // -------------------------------------------------------------
    console.log('--- TEST 7: Multimodal Tools Execution ---');

    const testImgPath = path.join(TEST_SCRATCH_DIR, 'test_sample.png');
    await fs.writeFile(testImgPath, MINIMAL_VALID_PNG);

    const testAudioPath = path.join(TEST_SCRATCH_DIR, 'test_sample.wav');
    await fs.writeFile(testAudioPath, mockWav);

    const mockMemory = {
      getMultimodalEngine: () => engine
    };
    const mockContext: any = { memory: mockMemory };

    // 7a. imageInspect tool
    const inspectToolRes = await imageInspectTool.execute({ imagePath: testImgPath }, mockContext);
    assert(inspectToolRes.success === true, 'imageInspect should succeed');
    assert(inspectToolRes.description !== undefined, 'Description should be returned');
    assert(inspectToolRes.artifactId !== undefined, 'Artifact ID should be returned');

    // 7b. imageGenerate tool
    const genToolRes = await imageGenerateTool.execute({ prompt: 'Neural network diagram' }, mockContext);
    assert(genToolRes.success === true, 'imageGenerate should succeed');
    assert(genToolRes.filePath !== undefined, 'File path should be returned');

    // 7c. voiceTranscribe tool
    const transToolRes = await voiceTranscribeTool.execute({ audioPath: testAudioPath }, mockContext);
    assert(transToolRes.success === true, 'voiceTranscribe should succeed');
    assert(transToolRes.text !== undefined, 'Text should be returned');

    // 7d. voiceSpeak tool
    const speakToolRes = await voiceSpeakTool.execute({ text: 'Status report ready' }, mockContext);
    assert(speakToolRes.success === true, 'voiceSpeak should succeed');
    assert(speakToolRes.audioPath !== undefined, 'Audio path should be returned');
    console.log('✓ TEST 7 PASSED: Multimodal tools execution verified.\n');

    // -------------------------------------------------------------
    // TEST 8: EXIT CRITERION 1: Voice Request Creates Goal via Normal Core Path
    // -------------------------------------------------------------
    console.log('--- TEST 8: EXIT CRITERION 1: Voice Request Creates Goal via Normal Core Path ---');

    // Setup Agent with EpisodicMemory backed by our SQLite stores
    const memory = new EpisodicMemory(TEST_DB_PATH);
    await memory.init();

    // Use Mock STT Provider with a realistic voice prompt
    const voiceEngine = new MultiModalEngine({
      store: memory.getMultimodalStore()!,
      sttProvider: new MockSTTProvider('Create a goal to deploy the security patch by Friday'),
      storageDir: TEST_SCRATCH_DIR
    });

    const agent = new Agent({
      modelName: 'gemini-2.0-flash',
      maxTurns: 5,
      systemPrompt: 'Core agent prompt',
      dbPath: TEST_DB_PATH
    });
    await agent.init();

    // Process voice request through core path
    const voiceResult = await voiceEngine.processVoiceRequest(testAudioPath, agent, {
      voiceResponse: true
    });

    // 8a. Verify transcript
    assert(voiceResult.transcript.text === 'Create a goal to deploy the security patch by Friday', 'Transcript should match');

    // 8b. Verify persistent Goal created in SQLite
    assert(voiceResult.goal !== undefined, 'Goal should be created');
    assert(voiceResult.goal.id.startsWith('goal_'), 'Goal ID should be prefixed');
    assert(voiceResult.goal.title.toLowerCase().includes('deploy the security patch'), 'Goal title formatted from voice request');
    assert(voiceResult.goal.metadata?.source === 'voice', 'Goal metadata source should be voice');

    const savedGoal = await memory.getGoalStore()!.get(voiceResult.goal.id);
    assert(savedGoal !== null, 'Goal must be persisted in SQLite goals table');
    assert(savedGoal!.id === voiceResult.goal.id, 'Persisted goal ID must match');

    // 8c. Verify planned tasks exist in SQLite
    assert(voiceResult.tasks.length > 0, 'Planned tasks must be generated');
    const savedTasks = await memory.getTaskStore()!.listByGoal(voiceResult.goal.id);
    assert(savedTasks.length === voiceResult.tasks.length, 'Tasks must be persisted in SQLite tasks table');

    // 8d. Verify voice audio response confirmation
    assert(voiceResult.audioResponse !== undefined, 'Audio confirmation must be synthesized');
    assert(voiceResult.audioResponse!.audioBuffer.length > 44, 'Voice response must contain valid WAV buffer');
    console.log('✓ TEST 8 PASSED: Exit Criterion 1 (Voice request creates persistent goal via core path) verified.\n');

    // -------------------------------------------------------------
    // TEST 9: EXIT CRITERION 2: Screenshot -> Browser -> Verify E2E
    // -------------------------------------------------------------
    console.log('--- TEST 9: EXIT CRITERION 2: Screenshot -> Browser -> Verify E2E ---');

    const initialScreenshotPath = path.join(TEST_SCRATCH_DIR, 'initial_dashboard.png');
    await fs.writeFile(initialScreenshotPath, MINIMAL_VALID_PNG);

    const loopResult = await engine.handleScreenshotToBrowserAction(
      initialScreenshotPath,
      {
        targetUrl: 'http://localhost:3000/settings',
        action: 'click',
        selector: 'button#save-preferences',
        expectedText: 'Login Dashboard',
        description: 'Analyze initial settings page and apply preferences'
      }
    );

    assert(loopResult.initialAnalysis !== undefined, 'Initial vision analysis must be present');
    assert(loopResult.verificationScreenshotPath.length > 0, 'Verification screenshot must be captured');
    assert(loopResult.verificationAnalysis !== undefined, 'Verification vision analysis must be present');
    assert(loopResult.verified === true, 'Verification outcome must confirm success');

    // Verify artifacts saved in multimodal store
    assert(loopResult.initialArtifact !== undefined, 'Initial screenshot artifact must be stored');
    assert(loopResult.verificationArtifact !== undefined, 'Verification screenshot artifact must be stored');

    const storedInitArt = await stores.multimodal.getArtifact(loopResult.initialArtifact!.id);
    assert(storedInitArt !== null, 'Initial artifact must be persisted in SQLite');

    const storedVerifArt = await stores.multimodal.getArtifact(loopResult.verificationArtifact!.id);
    assert(storedVerifArt !== null, 'Verification artifact must be persisted in SQLite');
    console.log('✓ TEST 9 PASSED: Exit Criterion 2 (Screenshot -> Browser -> Verify E2E) verified.\n');

    // -------------------------------------------------------------
    // TEST 10: Capability Registry (P9) Reflection
    // -------------------------------------------------------------
    console.log('--- TEST 10: Capability Registry (P9) Reflection ---');

    const registry = new CapabilityRegistry();
    seedP9Capabilities(registry);

    const visionCap = registry.get('multimodal.vision');
    assert(visionCap?.status === 'real', 'multimodal.vision must be status real');

    const sttCap = registry.get('multimodal.stt');
    assert(sttCap?.status === 'real', 'multimodal.stt must be status real');

    const ttsCap = registry.get('multimodal.tts');
    assert(ttsCap?.status === 'real', 'multimodal.tts must be status real');

    const imgCap = registry.get('multimodal.image_generation');
    assert(imgCap?.status === 'real', 'multimodal.image_generation must be status real');

    const voiceGoalCap = registry.get('multimodal.voice_goal_routing');
    assert(voiceGoalCap?.status === 'real', 'multimodal.voice_goal_routing must be status real');

    const loopCap = registry.get('multimodal.screenshot_browser_loop');
    assert(loopCap?.status === 'real', 'multimodal.screenshot_browser_loop must be status real');

    // Honest reflection of experimental & unsupported capabilities
    const duplexCap = registry.get('multimodal.realtime_voice_duplex');
    assert(duplexCap?.status === 'experimental', 'multimodal.realtime_voice_duplex must be experimental');
    assert(Boolean(duplexCap?.reason), 'Experimental capability must provide reason');

    const videoCap = registry.get('multimodal.video_streaming');
    assert(videoCap?.status === 'unsupported', 'multimodal.video_streaming must be unsupported');
    assert(Boolean(videoCap?.reason), 'Unsupported capability must provide reason');
    console.log('✓ TEST 10 PASSED: Capability registry reflection and honesty verified.\n');

    // -------------------------------------------------------------
    // TEST 11: Direct Agent Runtime Integration & Tool Execution
    // -------------------------------------------------------------
    console.log('--- TEST 11: Direct Agent Runtime Integration & Tool Execution ---');

    assert(typeof agent.getMultimodalEngine === 'function', 'agent.getMultimodalEngine must exist');
    assert(typeof agent.processVoice === 'function', 'agent.processVoice must exist');

    const agentEngine = agent.getMultimodalEngine();
    assert(agentEngine !== null, 'agent.getMultimodalEngine() must return MultiModalEngine');

    // Test tool execution via Agent ToolExecutor with agent context
    const executor = agent.getToolExecutor();
    const toolExecResult = await executor.execute(imageInspectTool, { imagePath: testImgPath }, { agent, memory });
    assert(toolExecResult.success === true, 'ToolExecutor should successfully execute imageInspect');
    assert(toolExecResult.data?.detectedText !== undefined, 'Image inspection data returned');

    // Test voiceGoalCreateTool with Agent context
    const voiceGoalToolResult = await executor.execute(voiceGoalCreateTool, { audioPath: testAudioPath }, { agent, memory });
    assert(voiceGoalToolResult.success === true, 'ToolExecutor should successfully execute voiceGoalCreate with agent in context');
    assert(voiceGoalToolResult.data?.goalId !== undefined, 'Goal ID must be returned by tool execution');

    // Test agent.processVoice convenience method
    const directVoiceRes = await agent.processVoice(testAudioPath);
    assert(directVoiceRes.goal !== undefined, 'agent.processVoice() must create a persistent goal');
    console.log('✓ TEST 11 PASSED: Agent runtime tool context and multimodal integration verified.\n');

    console.log('=============================================================');
    console.log('=== ALL 11 V2 P9 MULTIMODAL & VOICE TESTS PASSED (100%)   ===');
    console.log('=============================================================');
  } finally {
    await db.close();
    await cleanup();
  }
}

runTests().catch((err) => {
  console.error('\n❌ P9 TEST SUITE FAILED:', err);
  process.exit(1);
});
