// Set environment variables before anything else
process.env.OPENAI_API_KEY = 'sk-test-dummy-key';
process.env.GITHUB_TOKEN = 'ghp-test-dummy-token';

// Ensure mocks are set up before any module imports
// @ts-ignore
globalThis.___MASTRA_TELEMETRY___ = true;