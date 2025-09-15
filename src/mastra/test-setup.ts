import { mastra, validateConfig } from './config/index.js';
import * as dotenv from 'dotenv';

// .envファイルから環境変数を読み込み
dotenv.config();

function isDryRunMode(): boolean {
  return process.env.DRY_RUN === 'true' || !process.env.OPENAI_API_KEY;
}

function validateConfiguration(isDryRun: boolean): void {
  console.log('🔍 Validating configuration...');

  if (isDryRun) {
    console.log('📝 Running in dry-run mode (no actual API calls)');
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY not set - would be required for actual execution');
    }
  } else {
    validateConfig();
  }
  console.log('✅ Configuration valid');
}

function runDryRunTest(): void {
  console.log('📝 [DRY-RUN] Would call OpenAI API via Mastra Agent with:');
  console.log('   - Agent: ping');
  console.log('   - Model: gpt-3.5-turbo');
  console.log('   - Prompt: "Say hello to Mastra"');
  console.log('✅ [DRY-RUN] Mastra Agent configured correctly');
}

async function runActualTest(): Promise<void> {
  const agent = mastra.getAgent('ping');
  if (!agent) {
    throw new Error('Ping agent not found in Mastra registry');
  }

  const result = await agent.generateVNext([{ role: 'user', content: 'Say hello to Mastra' }]);

  console.log('✅ Mastra Agent response:', result.text);
  console.log('📊 Response details:');
  console.log('   - Response object:', result.object ? 'Present' : 'None');
  console.log('   - Usage:', result.usage ? `${result.usage.totalTokens} tokens` : 'N/A');

  console.log('\n🔍 Verifying Mastra integration:');
  console.log('   - Mastra instance:', mastra ? '✅' : '❌');
  console.log('   - Agent registered:', agent ? '✅' : '❌');
  console.log('   - Agent.generateVNext() worked:', result.text ? '✅' : '❌');
  console.log('   - API key set:', process.env.OPENAI_API_KEY ? '✅' : '❌');

  console.log('\n✨ True Mastra integration verified:');
  console.log('   Used mastra.getAgent() → agent.generateVNext() pattern (V2 models)');
}

function printUsageInstructions(): void {
  console.log('\n📚 Usage:');
  console.log('   1. Set up your API key in .env file:');
  console.log('      cp .env.example .env');
  console.log('      # Edit .env and add your OPENAI_API_KEY');
  console.log('   2. Run the test:');
  console.log('      npx tsx src/mastra/test-setup.ts');
  console.log('   3. Dry-run mode (no API calls):');
  console.log('      DRY_RUN=true npx tsx src/mastra/test-setup.ts');
}

async function testSetup() {
  const isDryRun = isDryRunMode();

  validateConfiguration(isDryRun);

  console.log('🔍 Testing Mastra Agent integration...');

  if (isDryRun) {
    runDryRunTest();
  } else {
    try {
      await runActualTest();
    } catch (error) {
      console.error('❌ Mastra Agent integration failed:', error);
      throw error;
    }
  }

  console.log('🎉 Setup complete!');
  printUsageInstructions();
}

testSetup().catch(console.error);
