/**
 * GitHub Link Generator
 * Generates clickable links to specific lines in GitHub repositories
 */

interface Repository {
  owner: string;
  name: string;
}

interface CodeUsage {
  file: string;
  line: number;
  reason?: string;
  context?: string;
}

export interface GitHubLinkOptions {
  repository: Repository;
  branch?: string;
  baseUrl?: string;
}

/**
 * Normalize file path to be relative to git repository root
 */
function normalizeFilePath(filePath: string): string {
  // If it's already a relative path, return as is
  if (!filePath.startsWith('/')) {
    return filePath;
  }
  
  try {
    const { execSync } = require('child_process');
    const gitRoot = execSync('git rev-parse --show-toplevel', { 
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
    
    // If the file path starts with the git root, make it relative
    if (filePath.startsWith(gitRoot)) {
      const relativePath = filePath.substring(gitRoot.length + 1); // +1 to remove the leading slash
      return relativePath;
    }
  } catch (error) {
    console.warn('Failed to get git root, using fallback normalization:', error);
  }
  
  // Fallback: try to extract path after 'src/' or other common patterns
  // Use lastIndexOf for safer pattern matching (avoids ReDoS)
  const srcIndex = filePath.lastIndexOf('/src/');
  if (srcIndex !== -1) {
    return filePath.substring(srcIndex + 1);
  }
  
  // Another fallback: remove common path prefixes
  let cleanPath = filePath;
  
  // Remove leading slash
  if (cleanPath.startsWith('/')) {
    cleanPath = cleanPath.substring(1);
  }
  
  // Try to find and remove absolute path prefixes
  const pathSegments = cleanPath.split('/');
  const srcSegmentIndex = pathSegments.findIndex(segment => segment === 'src');

  if (srcSegmentIndex !== -1) {
    return pathSegments.slice(srcSegmentIndex).join('/');
  }
  
  // Last resort: return the cleaned path
  return cleanPath;
}

/**
 * Generates a GitHub URL for a specific file and line number
 */
export function generateGitHubFileLink(
  filePath: string,
  line: number,
  options: GitHubLinkOptions
): string {
  const { repository, branch = 'main', baseUrl = 'https://github.com' } = options;
  
  // Normalize the file path to be relative to repository root
  const cleanPath = normalizeFilePath(filePath);
  
  return `${baseUrl}/${repository.owner}/${repository.name}/blob/${branch}/${cleanPath}#L${line}`;
}

/**
 * Generates a markdown link for a file location
 */
export function generateMarkdownLink(
  filePath: string, 
  line: number,
  options: GitHubLinkOptions
): string {
  const cleanPath = normalizeFilePath(filePath);
  const url = generateGitHubFileLink(filePath, line, options);
  return `[${cleanPath}:${line}](${url})`;
}

/**
 * Converts code usage array to markdown links
 */
export function generateUsageLinks(
  usages: CodeUsage[],
  options: GitHubLinkOptions
): Array<{
  file: string;
  line: number;
  markdownLink: string;
  reason?: string;
  context?: string;
}> {
  return usages.map(usage => ({
    ...usage,
    markdownLink: generateMarkdownLink(usage.file, usage.line, options)
  }));
}

/**
 * Generate links for breaking change sources
 */
export function generateSourceLinks(sources: Array<{
  type: string;
  url?: string;
  status: string;
}>): string[] {
  return sources
    .filter(source => source.url && source.status === 'success')
    .map(source => {
      switch (source.type) {
        case 'npm':
          return `[npm registry](${source.url})`;
        case 'github-releases':
          return `[GitHub Releases](${source.url})`;
        case 'github-changelog':
          return `[Changelog](${source.url})`;
        case 'github-compare':
          return `[Compare Changes](${source.url})`;
        default:
          return `[${source.type}](${source.url})`;
      }
    });
}

/**
 * Extract repository information from various sources
 */
export function extractRepositoryFromPRInfo(prInfo: any): Repository | null {
  try {
    if (prInfo?.repository?.owner && prInfo?.repository?.name) {
      return {
        owner: prInfo.repository.owner,
        name: prInfo.repository.name
      };
    }
    
    // Fallback: try to extract from HTML URL
    if (prInfo?.html_url) {
      const match = prInfo.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        return {
          owner: match[1],
          name: match[2]
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to extract repository info:', error);
    return null;
  }
}

/**
 * Get current git repository info from git remote
 */
export async function getRepositoryFromGit(): Promise<Repository | null> {
  try {
    const { execSync } = await import('child_process');
    const remoteUrl = execSync('git remote get-url origin', { 
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
    
    // Parse different Git URL formats
    let match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    
    if (match) {
      return {
        owner: match[1],
        name: match[2]
      };
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to get repository from git remote:', error);
    return null;
  }
}

/**
 * Auto-detect repository information from multiple sources
 */
export async function autoDetectRepository(prInfo?: any): Promise<Repository | null> {
  // Priority 1: PR info
  if (prInfo) {
    const repo = extractRepositoryFromPRInfo(prInfo);
    if (repo) {
      return repo;
    }
  }
  
  // Priority 2: Git remote
  const gitRepo = await getRepositoryFromGit();
  if (gitRepo) {
    return gitRepo;
  }
  
  return null;
}