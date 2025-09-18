import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getFiles } from './glob-helpers.js';
import { readJsonFile } from './file-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PackageMigration = {
  summary: string;
  breakingChanges: string[];
  migrationSteps: string[];
  affectedPackages?: string[];
  releaseDate?: string;
};

export type PackageKnowledge = {
  description?: string;
  repository?: string;
  migrations: Record<string, PackageMigration>;
  commonIssues?: Array<{
    version: string;
    issue: string;
    solution: string;
  }>;
  versionCompatibility?: Record<string, Record<string, string>>;
};

export class PackageKnowledgeBase {
  private readonly knowledge: Map<string, PackageKnowledge> = new Map();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    const knowledgeDir = join(__dirname, '../../data/package-knowledge');
    // Use getFiles with absolute paths
    const absoluteFiles = await getFiles(join(knowledgeDir, '*.json'), {
      absolute: true,
    });

    for (const absolutePath of absoluteFiles) {
      const data = await readJsonFile<Record<string, PackageKnowledge>>(absolutePath);
      if (data) {
        // Each file can contain multiple packages
        for (const [packageName, knowledge] of Object.entries(data)) {
          this.knowledge.set(packageName, knowledge);
        }
      }
    }

    this.loaded = true;
  }

  async getPackageKnowledge(packageName: string): Promise<PackageKnowledge | null> {
    await this.load();
    return this.knowledge.get(packageName) || null;
  }

  async getMigrationInfo(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<PackageMigration | null> {
    const knowledge = await this.getPackageKnowledge(packageName);
    if (!knowledge) return null;

    // Try exact version match
    const exactKey = `${fromVersion}->${toVersion}`;
    if (knowledge.migrations[exactKey]) {
      return knowledge.migrations[exactKey];
    }

    // Try major version match
    const fromMajor = fromVersion.split('.')[0];
    const toMajor = toVersion.split('.')[0];
    const majorKey = `${fromMajor}.x->${toMajor}.x`;

    if (knowledge.migrations[majorKey]) {
      return knowledge.migrations[majorKey];
    }

    // Try to find any migration that covers this range
    for (const [key, migration] of Object.entries(knowledge.migrations)) {
      if (this.versionRangeMatches(key, fromVersion, toVersion)) {
        return migration;
      }
    }

    return null;
  }

  async getBreakingChanges(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string[]> {
    const migration = await this.getMigrationInfo(packageName, fromVersion, toVersion);
    return migration?.breakingChanges || [];
  }

  async getMigrationSteps(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string[]> {
    const migration = await this.getMigrationInfo(packageName, fromVersion, toVersion);
    return migration?.migrationSteps || [];
  }

  async getCompatibilityInfo(
    packageName: string,
    version: string
  ): Promise<Record<string, string> | null> {
    const knowledge = await this.getPackageKnowledge(packageName);
    if (!knowledge?.versionCompatibility) return null;

    // Find the best matching version
    const versionMajor = version.split('.')[0];

    // Try exact version
    if (knowledge.versionCompatibility[version]) {
      return knowledge.versionCompatibility[version];
    }

    // Try major.x version
    const majorKey = `${versionMajor}.x`;
    if (knowledge.versionCompatibility[majorKey]) {
      return knowledge.versionCompatibility[majorKey];
    }

    return null;
  }

  private versionRangeMatches(rangeKey: string, fromVersion: string, toVersion: string): boolean {
    // Parse range key like "14.x->15.x" or "1.2.3->2.0.0"
    const match = /^(.+)->(.+)$/.exec(rangeKey);
    if (!match) return false;

    const [, rangeFrom, rangeTo] = match;

    // Simple major version comparison
    const fromMajor = parseInt(fromVersion.split('.')[0]);
    const toMajor = parseInt(toVersion.split('.')[0]);

    const rangeFromMajor = parseInt(rangeFrom.split('.')[0]);
    const rangeToMajor = parseInt(rangeTo.split('.')[0]);

    return fromMajor <= rangeFromMajor && toMajor >= rangeToMajor;
  }

  async getAllPackages(): Promise<string[]> {
    await this.load();
    return Array.from(this.knowledge.keys());
  }

  async searchPackages(query: string): Promise<string[]> {
    await this.load();
    const lowerQuery = query.toLowerCase();

    return Array.from(this.knowledge.keys()).filter((pkg) =>
      pkg.toLowerCase().includes(lowerQuery)
    );
  }

  async exportKnowledge(): Promise<Record<string, PackageKnowledge>> {
    await this.load();
    return Object.fromEntries(this.knowledge);
  }
}

// Singleton instance
export const packageKnowledgeBase = new PackageKnowledgeBase();
