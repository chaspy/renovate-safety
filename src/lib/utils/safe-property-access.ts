/**
 * Safe property access utilities for handling unknown data types
 */

/**
 * Type guard to check if a value is a Record
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard to check if a value is an object with specific property
 */
export function hasProperty<T extends PropertyKey>(
  obj: unknown,
  prop: T
): obj is Record<T, unknown> {
  return isRecord(obj) && prop in obj;
}

/**
 * Safe property access function
 */
export function safeProp(obj: unknown, prop: string): unknown {
  return isRecord(obj) && prop in obj ? obj[prop] : undefined;
}

/**
 * Safe property extractor factory
 */
export function createSafeExtractor(data: unknown) {
  const record = isRecord(data) ? data : {};

  return {
    getString: (prop: string, fallback = ''): string => {
      const value = safeProp(record, prop);
      return typeof value === 'string' ? value : fallback;
    },

    getNumber: (prop: string, fallback = 0): number => {
      const value = safeProp(record, prop);
      return typeof value === 'number' ? value : fallback;
    },

    getBoolean: (prop: string, fallback = false): boolean => {
      const value = safeProp(record, prop);
      return typeof value === 'boolean' ? value : fallback;
    },

    getObject: (prop: string): Record<string, unknown> | null => {
      const value = safeProp(record, prop);
      return isRecord(value) ? value : null;
    },

    getArray: <T = unknown>(prop: string): T[] => {
      const value = safeProp(record, prop);
      return Array.isArray(value) ? value : [];
    },

    getOptionalString: (prop: string): string | undefined => {
      const value = safeProp(record, prop);
      return typeof value === 'string' ? value : undefined;
    },

    getOptionalNumber: (prop: string): number | undefined => {
      const value = safeProp(record, prop);
      return typeof value === 'number' ? value : undefined;
    },
  };
}

/**
 * Extract author information safely
 */
export function extractAuthorInfo(data: unknown): string | undefined {
  const authorData = safeProp(data, 'author');
  
  if (typeof authorData === 'string') {
    return authorData;
  }
  
  if (isRecord(authorData)) {
    const name = safeProp(authorData, 'name');
    return typeof name === 'string' ? name : undefined;
  }
  
  return undefined;
}

/**
 * Extract maintainers list safely
 */
export function extractMaintainers(data: unknown): string[] {
  const maintainersData = safeProp(data, 'maintainers');
  
  if (!Array.isArray(maintainersData)) {
    return [];
  }
  
  return maintainersData
    .map((m: unknown) => {
      if (typeof m === 'string') {
        return m;
      }
      
      if (isRecord(m) && 'name' in m) {
        const name = safeProp(m, 'name');
        return typeof name === 'string' ? name : (typeof name === 'number' ? String(name) : '');
      }
      
      return typeof m === 'string' ? m : (typeof m === 'number' ? String(m) : '');
    })
    .filter(Boolean);
}

/**
 * Extract published date safely
 */
export function extractPublishedDate(
  data: unknown,
  version: string
): string {
  const extractor = createSafeExtractor(data);
  
  // Try to get date from time[version] first
  const timeObj = extractor.getObject('time');
  if (timeObj) {
    const versionDate = safeProp(timeObj, version);
    if (typeof versionDate === 'string') {
      return versionDate;
    }
    
    // Fallback to created date
    const created = safeProp(timeObj, 'created');
    if (typeof created === 'string') {
      return created;
    }
  }
  
  return '';
}

/**
 * Extract size information safely
 */
export function extractSizeInfo(data: unknown): { unpacked: number; gzipped?: number } {
  const distData = safeProp(data, 'dist');
  
  if (!isRecord(distData)) {
    return { unpacked: 0 };
  }
  
  const extractor = createSafeExtractor(distData);
  
  return {
    unpacked: extractor.getNumber('unpackedSize', 0),
    gzipped: extractor.getOptionalNumber('size'),
  };
}