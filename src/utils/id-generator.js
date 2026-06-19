/**
 * Generate unique IDs with a prefix
 */
let counter = 0;

export function generateId(prefix = 'sym') {
  counter++;
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}_${counter}`;
}
