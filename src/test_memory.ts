import { EpisodicMemory } from './core/memory.js';
import * as fs from 'fs/promises';

async function runTests() {
  const dbPath = './test_state.db';
  
  // Clean up any old test database
  try {
    await fs.unlink(dbPath);
  } catch (e) {}

  console.log('--- TEST 1: Initialization ---');
  const memory = new EpisodicMemory(dbPath);
  await memory.init();
  console.log('Database initialized successfully.');

  console.log('--- TEST 2: Save Messages ---');
  await memory.saveMessage('session_test', 'user', [{ text: 'Who won the World Cup in 2022?' }]);
  await memory.saveMessage('session_test', 'model', [{ text: 'Argentina won the FIFA World Cup in 2022.' }]);
  await memory.saveMessage('session_test', 'user', [{ text: 'Who was the top scorer?' }]);
  await memory.saveMessage('session_test', 'model', [{ text: 'Kylian Mbappé was the top scorer with 8 goals.' }]);
  console.log('Saved 4 turns of messages.');

  console.log('--- TEST 3: Load History ---');
  const history = await memory.loadHistory('session_test', 2);
  console.log('Loaded history (limit 2):', JSON.stringify(history, null, 2));
  if (history.length !== 2) {
    throw new Error(`Expected 2 messages, got ${history.length}`);
  }
  const firstPart = history[0].parts[0];
  if (!('text' in firstPart) || firstPart.text !== 'Who was the top scorer?') {
    throw new Error(`Chronological order test failed. First item text: ${JSON.stringify(firstPart)}`);
  }
  console.log('Chronological load order verified.');

  console.log('--- TEST 4: FTS5 Search ---');
  const matches = await memory.search('Argentina');
  console.log('Search matches for "Argentina":', JSON.stringify(matches, null, 2));
  if (matches.length === 0) {
    throw new Error('Search failed: No matches found for "Argentina"');
  }
  console.log('FTS5 search works.');

  console.log('--- TEST 5: Clear History ---');
  await memory.clearHistory('session_test');
  const clearedHistory = await memory.loadHistory('session_test');
  console.log('Loaded history after clear:', clearedHistory);
  if (clearedHistory.length !== 0) {
    throw new Error(`Expected 0 messages after clear, got ${clearedHistory.length}`);
  }
  console.log('History clearing verified.');

  await memory.close();
  
  // Clean up the test database
  try {
    await fs.unlink(dbPath);
  } catch (e) {}

  console.log('\nALL DATABASE TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('DATABASE TESTS FAILED:', err);
  process.exit(1);
});
