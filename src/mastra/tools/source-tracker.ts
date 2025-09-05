/**
 * Source Tracker
 * Enhanced source tracking for breaking changes and dependency information
 */

export interface BreakingChangeSource {
  type: 'npm' | 'github-releases' | 'github-changelog' | 'github-compare' | 'documentation' | 'migration-guide';
  url: string;
  status: 'success' | 'failed' | 'partial';
  title?: string;
  description?: string;
  confidence: number; // 0-1
  extractedAt: Date;
}

export interface SourceCollection {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  sources: BreakingChangeSource[];
  primarySource?: BreakingChangeSource;
  fallbackSources: BreakingChangeSource[];
}

/**
 * Enhanced source link generator with better categorization
 */
export function generateEnhancedSourceLinks(sources: BreakingChangeSource[]): Array<{
  category: string;
  links: string[];
  confidence: number;
}> {
  const categorized: Record<string, { links: string[]; confidence: number[] }> = {};
  
  for (const source of sources.filter(s => s.status === 'success')) {
    const category = getCategoryName(source.type);
    
    if (!categorized[category]) {
      categorized[category] = { links: [], confidence: [] };
    }
    
    const linkText = source.title || source.type;
    categorized[category].links.push(`[${linkText}](${source.url})`);
    categorized[category].confidence.push(source.confidence);
  }
  
  return Object.entries(categorized).map(([category, data]) => ({
    category,
    links: data.links,
    confidence: data.confidence.reduce((a, b) => a + b, 0) / data.confidence.length
  })).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Generate comprehensive source section for markdown
 */
export function generateSourceSection(
  collection: SourceCollection,
  isJapanese: boolean = false
): string {
  if (collection.sources.length === 0) {
    return '';
  }
  
  let section = isJapanese ? '\n#### 📚 参考資料\n' : '\n#### 📚 Sources\n';
  
  const categorized = generateEnhancedSourceLinks(collection.sources);
  
  for (const { category, links, confidence } of categorized) {
    if (links.length === 0) continue;
    
    const confidenceIcon = getConfidenceIcon(confidence);
    section += `**${confidenceIcon} ${category}**:\n`;
    
    for (const link of links) {
      section += `- ${link}\n`;
    }
    section += '\n';
  }
  
  // Add verification note for low confidence sources
  const lowConfidenceSources = collection.sources.filter(s => s.confidence < 0.5);
  if (lowConfidenceSources.length > 0) {
    section += isJapanese 
      ? '*注：一部の情報源は信頼性が低い可能性があります。公式ドキュメントでの確認を推奨します。*\n'
      : '*Note: Some sources may have lower reliability. Please verify with official documentation.*\n';
  }
  
  return section;
}

/**
 * Enhanced npm registry URL builder
 */
export function buildNpmRegistryUrl(packageName: string, version?: string): BreakingChangeSource {
  const baseUrl = `https://www.npmjs.com/package/${packageName}`;
  const url = version ? `${baseUrl}/v/${version}` : baseUrl;
  
  return {
    type: 'npm',
    url,
    status: 'success',
    title: `${packageName} on npm`,
    description: `Official npm registry page for ${packageName}`,
    confidence: 0.9,
    extractedAt: new Date()
  };
}

/**
 * Enhanced GitHub repository URL detection and building
 */
export function buildGitHubUrls(packageName: string, repositoryUrl?: string): BreakingChangeSource[] {
  const sources: BreakingChangeSource[] = [];
  
  if (!repositoryUrl) {
    return sources;
  }
  
  try {
    const match = repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!match) return sources;
    
    const [, owner, repo] = match;
    const baseUrl = `https://github.com/${owner}/${repo}`;
    
    // Releases page
    sources.push({
      type: 'github-releases',
      url: `${baseUrl}/releases`,
      status: 'success',
      title: 'GitHub Releases',
      description: `Release notes and changelogs for ${packageName}`,
      confidence: 0.85,
      extractedAt: new Date()
    });
    
    // Changelog detection (common filenames)
    const changelogFiles = ['CHANGELOG.md', 'HISTORY.md', 'CHANGES.md', 'RELEASES.md'];
    for (const filename of changelogFiles) {
      sources.push({
        type: 'github-changelog',
        url: `${baseUrl}/blob/main/${filename}`,
        status: 'partial', // Need to verify if file exists
        title: filename,
        description: `${filename} in repository`,
        confidence: 0.7,
        extractedAt: new Date()
      });
    }
    
    return sources;
  } catch (error) {
    console.warn('Failed to parse repository URL:', error);
    return sources;
  }
}

/**
 * Build version comparison URL
 */
export function buildCompareUrl(
  repositoryUrl: string,
  fromVersion: string,
  toVersion: string
): BreakingChangeSource | null {
  try {
    const match = repositoryUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!match) return null;
    
    const [, owner, repo] = match;
    const baseUrl = `https://github.com/${owner}/${repo}`;
    
    // Clean version tags (remove 'v' prefix if present)
    const fromTag = fromVersion.startsWith('v') ? fromVersion : `v${fromVersion}`;
    const toTag = toVersion.startsWith('v') ? toVersion : `v${toVersion}`;
    
    return {
      type: 'github-compare',
      url: `${baseUrl}/compare/${fromTag}...${toTag}`,
      status: 'success',
      title: `Compare ${fromVersion}...${toVersion}`,
      description: `Detailed changes between versions`,
      confidence: 0.8,
      extractedAt: new Date()
    };
  } catch (error) {
    console.warn('Failed to build compare URL:', error);
    return null;
  }
}

/**
 * Build comprehensive source collection for a package
 */
export async function buildSourceCollection(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  repositoryUrl?: string
): Promise<SourceCollection> {
  const sources: BreakingChangeSource[] = [];
  
  // npm registry
  sources.push(buildNpmRegistryUrl(packageName));
  sources.push(buildNpmRegistryUrl(packageName, toVersion));
  
  // GitHub sources
  if (repositoryUrl) {
    sources.push(...buildGitHubUrls(packageName, repositoryUrl));
    
    const compareUrl = buildCompareUrl(repositoryUrl, fromVersion, toVersion);
    if (compareUrl) {
      sources.push(compareUrl);
    }
  }
  
  // Sort by confidence
  sources.sort((a, b) => b.confidence - a.confidence);
  
  const collection: SourceCollection = {
    packageName,
    fromVersion,
    toVersion,
    sources,
    primarySource: sources.find(s => s.confidence >= 0.8),
    fallbackSources: sources.filter(s => s.confidence < 0.8)
  };
  
  return collection;
}

/**
 * Verify source accessibility (basic check)
 */
export async function verifySourceAccessibility(source: BreakingChangeSource): Promise<boolean> {
  try {
    // This would typically make an HTTP request to verify the URL exists
    // For now, we'll do basic URL validation
    const url = new URL(source.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Utility functions

function getCategoryName(type: string): string {
  switch (type) {
    case 'npm': return 'npm Registry';
    case 'github-releases': return 'GitHub Releases';
    case 'github-changelog': return 'Changelog';
    case 'github-compare': return 'Version Comparison';
    case 'documentation': return 'Documentation';
    case 'migration-guide': return 'Migration Guide';
    default: return 'Other';
  }
}

function getConfidenceIcon(confidence: number): string {
  if (confidence >= 0.8) return '🟢';
  if (confidence >= 0.6) return '🟡';
  return '🔴';
}