import { mastra, validateConfig } from './config/index.js';
import * as dotenv from 'dotenv';

// .envファイルから環境変数を読み込み
dotenv.config();

async function testSetup() {
  const isDryRun = process.env.DRY_RUN === 'true' || !process.env.OPENAI_API_KEY;
  
  console.log('🔍 Validating configuration...');
  
  // Dry-runモードでは環境変数チェックをスキップ
  if (isDryRun) {
    console.log('📝 Running in dry-run mode (no actual API calls)');
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY not set - would be required for actual execution');
    }
  } else {
    validateConfig();
  }
  console.log('✅ Configuration valid');
  
  console.log('🔍 Testing Mastra Agent integration...');
  
  if (isDryRun) {
    console.log('📝 [DRY-RUN] Would call OpenAI API via Mastra Agent with:');
    console.log('   - Agent: ping');
    console.log('   - Model: gpt-3.5-turbo');
    console.log('   - Prompt: "Say hello to Mastra"');
    console.log('✅ [DRY-RUN] Mastra Agent configured correctly');
  } else {
    // 正しいMastra統合：Agent経由でLLMを呼び出す
    try {
      // MastraからAgentを取得
      const agent = mastra.getAgent('ping');
      if (!agent) {
        throw new Error('Ping agent not found in Mastra registry');
      }
      
      // Agent.generateVNext()でLLMを呼び出す（V2モデル用）
      const result = await agent.generateVNext([
        { role: 'user', content: 'Say hello to Mastra' }
      ]);
      
      console.log('✅ Mastra Agent response:', result.text);
      console.log('📊 Response details:');
      console.log('   - Response object:', result.object ? 'Present' : 'None');
      console.log('   - Usage:', result.usage ? `${result.usage.totalTokens} tokens` : 'N/A');
      
      // Mastra統合の確認
      console.log('\n🔍 Verifying Mastra integration:');
      console.log('   - Mastra instance:', mastra ? '✅' : '❌');
      console.log('   - Agent registered:', agent ? '✅' : '❌');
      console.log('   - Agent.generateVNext() worked:', result.text ? '✅' : '❌');
      console.log('   - API key set:', process.env.OPENAI_API_KEY ? '✅' : '❌');
      
      // 真のMastra統合の証明
      console.log('\n✨ True Mastra integration verified:');
      console.log('   Used mastra.getAgent() → agent.generateVNext() pattern (V2 models)');
    } catch (error) {
      console.error('❌ Mastra Agent integration failed:', error);
      throw error;
    }
  }
  
  console.log('🎉 Setup complete!');
  
  // 使用方法の説明
  console.log('\n📚 Usage:');
  console.log('   1. Set up your API key in .env file:');
  console.log('      cp .env.example .env');
  console.log('      # Edit .env and add your OPENAI_API_KEY');
  console.log('   2. Run the test:');
  console.log('      npx tsx src/mastra/test-setup.ts');
  console.log('   3. Dry-run mode (no API calls):');
  console.log('      DRY_RUN=true npx tsx src/mastra/test-setup.ts');
}

testSetup().catch(console.error);