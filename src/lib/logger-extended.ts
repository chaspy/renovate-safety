/**
 * Extended logging utilities for structured output
 */

import chalk from 'chalk';
import { setInterval, clearInterval } from 'node:timers';

/**
 * Log a section header with optional emoji
 */
export function logSection(title: string, emoji?: string): void {
  const header = emoji ? `${emoji} ${title}` : title;
  console.log(`\n${chalk.bold(header)}`);
}

/**
 * Log a list item with proper indentation
 */
export function logListItem(message: string, level: number = 1): void {
  const indent = '  '.repeat(level);
  console.log(`${indent}• ${message}`);
}

/**
 * Log a numbered list item
 */
export function logNumberedItem(number: number, message: string, level: number = 1): void {
  const indent = '  '.repeat(level);
  console.log(`${indent}${number}. ${message}`);
}

/**
 * Log progress information
 */
export function logProgress(current: number, total: number, message: string): void {
  const percentage = Math.round((current / total) * 100);
  console.log(`[${current}/${total}] ${percentage}% - ${message}`);
}

/**
 * Log a key-value pair
 */
export function logKeyValue(key: string, value: string | number, indent: number = 1): void {
  const spacing = '  '.repeat(indent);
  console.log(`${spacing}${chalk.gray(key + ':')} ${value}`);
}

/**
 * Log a success message with checkmark
 */
export function logSuccess(message: string, details?: string): void {
  const successMark = chalk.green('✓');
  if (details) {
    console.log(`${successMark} ${message} - ${chalk.gray(details)}`);
  } else {
    console.log(`${successMark} ${message}`);
  }
}

/**
 * Log a warning message with warning sign
 */
export function logWarningMessage(message: string, details?: string): void {
  const warningMark = chalk.yellow('⚠');
  if (details) {
    console.log(`${warningMark} ${message} - ${chalk.gray(details)}`);
  } else {
    console.log(`${warningMark} ${message}`);
  }
}

/**
 * Log an error message with X mark
 */
export function logError(message: string, error?: unknown): void {
  const errorMark = chalk.red('✗');
  console.log(`${errorMark} ${message}`);
  if (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'object' && error !== null 
        ? JSON.stringify(error)
        : String(error);
    console.log(`   ${chalk.red(errorMessage)}`);
  }
}

/**
 * Log a separator line
 */
export function logSeparator(char: string = '-', length: number = 40): void {
  console.log(char.repeat(length));
}

/**
 * Log a box around text
 */
export function logBox(text: string, padding: number = 1): void {
  const lines = text.split('\n');
  const maxLength = Math.max(...lines.map((line) => line.length));
  const boxWidth = maxLength + padding * 2 + 2;

  // Top border
  console.log('┌' + '─'.repeat(boxWidth - 2) + '┐');

  // Content with padding
  lines.forEach((line) => {
    const paddedLine = line.padEnd(maxLength);
    const spacing = ' '.repeat(padding);
    console.log(`│${spacing}${paddedLine}${spacing}│`);
  });

  // Bottom border
  console.log('└' + '─'.repeat(boxWidth - 2) + '┘');
}

/**
 * Log a table of data
 */
export function logTable(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const columnWidths = headers.map((header, i) => {
    const maxRowWidth = Math.max(...rows.map((row) => (row[i] || '').length));
    return Math.max(header.length, maxRowWidth);
  });

  // Print headers
  const headerRow = headers.map((header, i) => header.padEnd(columnWidths[i])).join(' │ ');
  console.log(headerRow);
  console.log(columnWidths.map((w) => '─'.repeat(w)).join('─┼─'));

  // Print rows
  rows.forEach((row) => {
    const formattedRow = row.map((cell, i) => (cell || '').padEnd(columnWidths[i])).join(' │ ');
    console.log(formattedRow);
  });
}

/**
 * Log with timestamp
 */
export function logTimestamp(message: string): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${chalk.gray(timestamp)}] ${message}`);
}

/**
 * Log a multi-line code block
 */
export function logCodeBlock(code: string, language?: string): void {
  console.log();
  if (language) {
    console.log(chalk.gray(`\`\`\`${language}`));
  } else {
    console.log(chalk.gray('```'));
  }
  console.log(code);
  console.log(chalk.gray('```'));
  console.log();
}

/**
 * Create a spinner-like progress indicator (simple version)
 */
export function logSpinner(message: string): { stop: () => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${message}`);
    i = (i + 1) % frames.length;
  }, 100);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(message.length + 3) + '\r');
    },
  };
}
