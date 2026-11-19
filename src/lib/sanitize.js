/**
 * Qartix Data Sanitization & XSS Defense Utility
 * Defense-in-depth sanitizer for user-provided text fields (names, reasons, notes, identifiers).
 */

/**
 * Strips dangerous HTML tags, inline javascript:, and unprintable control characters.
 * @param {string} input - Raw user input string
 * @param {number} [maxLength=500] - Maximum allowable character length
 * @returns {string} Sanitized plain-text string
 */
export function sanitizeText(input, maxLength = 500) {
  if (typeof input !== 'string') return '';

  return input
    // Trim whitespace
    .trim()
    // Remove control characters (except common whitespace like \n, \r, \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Strip HTML tag brackets and dangerous tokens
    .replace(/<[^>]*>/g, '')
    // Neutralize dangerous URI schemes if typed in text
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '')
    .replace(/vbscript:/gi, '')
    // Truncate to maximum permissible length
    .slice(0, maxLength);
}

/**
 * Sanitizes an object of string fields against XSS.
 * @param {Record<string, any>} fieldsObj 
 * @returns {Record<string, any>}
 */
export function sanitizeFields(fieldsObj) {
  if (!fieldsObj || typeof fieldsObj !== 'object') return {};
  const cleaned = {};
  for (const [key, val] of Object.entries(fieldsObj)) {
    if (typeof val === 'string') {
      cleaned[key] = sanitizeText(val, key === 'reason' ? 1000 : 255);
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
}
