import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { fetchChangelogDiff } from '../../lib/changelog.js';
import { httpGet } from '../../lib/http-client.js';
import type { PackageUpdate } from '../../types/index.js';

// Zod schemas
const inputSchema = z.object({
  packageName: z.string().describe('Package name'),
  registry: z.enum(['npm', 'pypi']).describe('Package registry'),
  fromVersion: z.string().describe('Starting version'),
  toVersion: z.string().describe('Ending version'),
});

const outputSchema = z.object({
  success: z.boolean(),
  content: z.string().optional(),
  source: z.string().optional(),
  error: z.string().optional(),
});

export const changelogFetcher = createTool({
  id: 'changelogFetcher',
  description: 'Fetch changelog from package registry (npm or PyPI)',
  inputSchema,
  outputSchema,
  
  execute: async ({ context: { packageName, registry, fromVersion, toVersion } }) => {
    try {
      const packageUpdate: PackageUpdate = {
        name: packageName,
        fromVersion,
        toVersion,
      };

      if (registry === 'npm') {
        // Use existing changelog fetching logic for npm
        const result = await fetchChangelogDiff(packageUpdate, '.cache/changelog');
        
        if (result) {
          return {
            success: true,
            content: result.content,
            source: result.source || 'npm',
          };
        }

        // Fallback: try to get directly from npm registry metadata
        const npmResult = await fetchNpmChangelog(packageName, fromVersion, toVersion);
        if (npmResult) {
          return npmResult;
        }
      }

      if (registry === 'pypi') {
        // PyPI-specific changelog fetching
        const result = await fetchPyPiChangelog(packageName, fromVersion, toVersion);
        if (result) {
          return result;
        }
      }

      return {
        success: false,
        error: `No changelog found for ${packageName} from ${fromVersion} to ${toVersion}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to fetch changelog: ${errorMessage}`,
      };
    }
  },
});

async function fetchNpmChangelog(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<{ success: boolean; content?: string; source?: string; error?: string } | null> {
  try {
    // Try to get changelog from npm registry metadata
    const response = await httpGet<any>(`https://registry.npmjs.org/${packageName}`);
    
    if (!response.ok || !response.data) {
      return null;
    }

    const data = response.data;
    
    // Check if specific versions have changelog in their dist tags or time entries
    const versions = data.versions || {};
    const toVersionData = versions[toVersion];
    
    if (toVersionData) {
      // Some packages include changelog in the package.json description
      const description = toVersionData.description || data.description;
      
      // Check if there's a readme that might contain changelog
      const readme = data.readme || toVersionData.readme;
      
      if (readme) {
        // Extract changelog section from README if present
        const changelogSection = extractChangelogFromReadme(readme, fromVersion, toVersion);
        if (changelogSection) {
          return {
            success: true,
            content: changelogSection,
            source: 'npm-readme',
          };
        }
      }
      
      // If we have basic info, return minimal changelog
      if (description) {
        return {
          success: true,
          content: `# ${packageName}\n\n## ${toVersion}\n\n${description}`,
          source: 'npm-metadata',
        };
      }
    }

    return null;
  } catch (error) {
    console.warn('Failed to fetch npm changelog:', error);
    return null;
  }
}

async function fetchPyPiChangelog(
  packageName: string,
  fromVersion: string,
  toVersion: string
): Promise<{ success: boolean; content?: string; source?: string; error?: string }> {
  try {
    // Fetch package info from PyPI
    const response = await httpGet<any>(`https://pypi.org/pypi/${packageName.toLowerCase()}/json`);

    if (!response.ok || !response.data) {
      return {
        success: false,
        error: `Package ${packageName} not found on PyPI`,
      };
    }

    const data = response.data;
    const changelogUrl = findChangelogUrl(data.info?.project_urls || {});
    const content = buildPyPiChangelogContent(
      packageName,
      toVersion,
      fromVersion,
      data,
      changelogUrl
    );

    return {
      success: true,
      content,
      source: 'pypi',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to fetch PyPI changelog: ${errorMessage}`,
    };
  }
}

function findChangelogUrl(projectUrls: Record<string, unknown>): string | null {
  for (const [key, url] of Object.entries(projectUrls)) {
    if (typeof url === 'string') {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('changelog') || keyLower.includes('changes')) {
        return url;
      }
    }
  }
  return null;
}

function buildPyPiChangelogContent(
  packageName: string,
  toVersion: string,
  fromVersion: string,
  data: any,
  changelogUrl: string | null
): string {
  const description = data.info?.description || '';
  const summary = data.info?.summary || '';
  const releases = data.releases || {};
  const toRelease = releases[toVersion];

  let content = `# ${packageName} Changelog\n\n`;
  content += `## Version ${toVersion}\n\n`;

  if (toRelease?.[0]?.comment_text) {
    content += toRelease[0].comment_text + '\n\n';
  } else if (summary) {
    content += `${summary}\n\n`;
  }

  if (description?.toLowerCase().includes('change')) {
    const changelogSection = extractChangelogFromText(description, fromVersion, toVersion);
    if (changelogSection) {
      content += changelogSection;
    } else {
      content += description.substring(0, 1000);
    }
  }

  if (changelogUrl) {
    content += `\n\nFull changelog: ${changelogUrl}`;
  }

  return content;
}

function extractChangelogFromReadme(readme: string, _fromVersion: string, toVersion: string): string | null {
  // Look for changelog section
  const changelogMatch = /#{1,3}\s*(changelog|changes|release notes|history)/i.exec(readme);
  
  if (!changelogMatch) {
    return null;
  }
  
  const startIndex = changelogMatch.index || 0;
  const changelogSection = readme.substring(startIndex);
  
  // Try to extract relevant version sections
  const versionPattern = new RegExp(`[#*-].*${escapeRegExp(toVersion)}`, 'i');
  const versionMatch = changelogSection.match(versionPattern);
  
  if (versionMatch) {
    // Return section around the target version
    const versionIndex = versionMatch.index || 0;
    return changelogSection.substring(versionIndex, versionIndex + 2000);
  }
  
  // Return first part of changelog section
  return changelogSection.substring(0, 2000);
}

function extractChangelogFromText(text: string, _fromVersion: string, toVersion: string): string | null {
  // Look for version-specific sections
  const versionPattern = new RegExp(`[#*-v].*${escapeRegExp(toVersion)}`, 'i');
  const versionMatch = text.match(versionPattern);
  
  if (versionMatch) {
    const startIndex = versionMatch.index || 0;
    // Find next version section or take next 1000 chars
    // Limit whitespace matching to prevent ReDoS (Regular Expression Denial of Service)
    const nextVersionPattern = /[#*\-v]\s*\d+\.\d+/;
    const restText = text.substring(startIndex + versionMatch[0].length);
    const nextMatch = restText.match(nextVersionPattern);
    
    if (nextMatch?.index) {
      return text.substring(startIndex, startIndex + versionMatch[0].length + nextMatch.index);
    }
    
    return text.substring(startIndex, Math.min(startIndex + 1000, text.length));
  }
  
  return null;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}