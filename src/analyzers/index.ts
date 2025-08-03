// Register all analyzers
import { analyzerRegistry } from './base.js';
import { NpmAnalyzer } from './npm/NpmAnalyzer.js';
import { PyPiAnalyzer } from './python/PyPiAnalyzer.js';

// Register analyzers
analyzerRegistry.register(new NpmAnalyzer());
analyzerRegistry.register(new PyPiAnalyzer());

// Export for use
export { analyzerRegistry };
export * from './base.js';
export * from './strategies/base.js';
