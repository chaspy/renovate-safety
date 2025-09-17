import { describe, it, expect } from 'vitest';
import { 
  isRecord, 
  hasProperty, 
  createSafeExtractor, 
  extractAuthorInfo, 
  extractMaintainers, 
  extractSizeInfo 
} from '../safe-property-access.js';

describe('Safe Property Access', () => {
  describe('isRecord', () => {
    it('should return true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ name: 'test' })).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord('string')).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord([])).toBe(false);
    });
  });

  describe('hasProperty', () => {
    it('should detect existing properties', () => {
      const obj = { name: 'test', value: 123 };
      expect(hasProperty(obj, 'name')).toBe(true);
      expect(hasProperty(obj, 'value')).toBe(true);
      expect(hasProperty(obj, 'missing')).toBe(false);
    });
  });

  describe('createSafeExtractor', () => {
    const testData = {
      name: 'test-package',
      version: '1.0.0',
      count: 42,
      active: true,
      tags: ['tag1', 'tag2'],
      nested: { inner: 'value' }
    };

    const extractor = createSafeExtractor(testData);

    it('should extract strings safely', () => {
      expect(extractor.getString('name')).toBe('test-package');
      expect(extractor.getString('missing', 'default')).toBe('default');
    });

    it('should extract numbers safely', () => {
      expect(extractor.getNumber('count')).toBe(42);
      expect(extractor.getNumber('missing', 0)).toBe(0);
    });

    it('should extract booleans safely', () => {
      expect(extractor.getBoolean('active')).toBe(true);
      expect(extractor.getBoolean('missing', false)).toBe(false);
    });

    it('should extract arrays safely', () => {
      expect(extractor.getArray('tags')).toEqual(['tag1', 'tag2']);
      expect(extractor.getArray('missing')).toEqual([]);
    });

    it('should extract objects safely', () => {
      expect(extractor.getObject('nested')).toEqual({ inner: 'value' });
      expect(extractor.getObject('missing')).toBeNull();
    });
  });

  describe('extractAuthorInfo', () => {
    it('should extract string author', () => {
      const data = { author: 'John Doe' };
      expect(extractAuthorInfo(data)).toBe('John Doe');
    });

    it('should extract object author', () => {
      const data = { author: { name: 'Jane Smith', email: 'jane@example.com' } };
      expect(extractAuthorInfo(data)).toBe('Jane Smith');
    });

    it('should return undefined for missing author', () => {
      expect(extractAuthorInfo({})).toBeUndefined();
      expect(extractAuthorInfo({ author: null })).toBeUndefined();
    });
  });

  describe('extractMaintainers', () => {
    it('should extract string maintainers', () => {
      const data = { maintainers: ['user1', 'user2'] };
      expect(extractMaintainers(data)).toEqual(['user1', 'user2']);
    });

    it('should extract object maintainers', () => {
      const data = { 
        maintainers: [
          { name: 'User One' },
          { name: 'User Two' },
          'plain-string'
        ] 
      };
      expect(extractMaintainers(data)).toEqual(['User One', 'User Two', 'plain-string']);
    });

    it('should return empty array for missing maintainers', () => {
      expect(extractMaintainers({})).toEqual([]);
      expect(extractMaintainers({ maintainers: null })).toEqual([]);
    });
  });

  describe('extractSizeInfo', () => {
    it('should extract size information', () => {
      const data = { 
        dist: { 
          unpackedSize: 1024,
          size: 512
        } 
      };
      expect(extractSizeInfo(data)).toEqual({ unpacked: 1024, gzipped: 512 });
    });

    it('should return defaults for missing size info', () => {
      expect(extractSizeInfo({})).toEqual({ unpacked: 0 });
      expect(extractSizeInfo({ dist: null })).toEqual({ unpacked: 0 });
    });
  });
});