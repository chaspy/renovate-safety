/**
 * Common HTTP client utilities
 * Provides centralized HTTP request patterns to reduce code duplication
 */

import { validateUrl, escapeForUrl } from './validation.js';
import { getErrorMessage } from '../analyzers/utils.js';

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface HttpResponse<T = any> {
  data: T | null;
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Centralized HTTP GET request with validation and error handling
 */
export async function httpGet<T = any>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  try {
    // Validate URL
    validateUrl(url);
    
    // Use dynamic import for node-fetch
    const { default: fetch } = await import('node-fetch');
    
    const response = await fetch(url, {
      headers: options.headers,
      timeout: options.timeout || 30000,
    });
    
    if (!response.ok) {
      return {
        data: null,
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    const data = await response.json();
    return {
      data,
      ok: true,
      status: response.status
    };
  } catch (error) {
    return {
      data: null,
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * Fetch PyPI package data with common error handling
 */
export async function fetchPyPiPackage(
  packageName: string,
  version: string
): Promise<HttpResponse<any>> {
  const url = `https://pypi.org/pypi/${escapeForUrl(packageName)}/${escapeForUrl(version)}/json`;
  return httpGet(url);
}

/**
 * Generic fetch with logging for debugging
 */
export async function fetchWithLogging<T = any>(
  url: string,
  context: string,
  options: HttpRequestOptions = {}
): Promise<T | null> {
  const response = await httpGet<T>(url, options);
  
  if (!response.ok) {
    console.warn(`Failed to fetch ${context}:`, response.error);
    return null;
  }
  
  return response.data;
}