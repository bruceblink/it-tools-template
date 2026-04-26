import { describe, expect, it } from 'vitest';
import { formatMsDuration } from './eta-calculator.service';

describe('eta-calculator service', () => {
  describe('formatMsDuration', () => {
    it('formats zero duration', () => {
      expect(formatMsDuration(0)).toBe('');
    });

    it('formats milliseconds only', () => {
      // when there are no hours/minutes/seconds, formatDuration returns empty string,
      // so the result has a leading space before the ms value
      expect(formatMsDuration(500).trim()).toBe('500 ms');
    });

    it('formats seconds only', () => {
      expect(formatMsDuration(5000)).toBe('5 seconds');
    });

    it('formats minutes only', () => {
      expect(formatMsDuration(3 * 60 * 1000)).toBe('3 minutes');
    });

    it('formats hours only', () => {
      expect(formatMsDuration(2 * 60 * 60 * 1000)).toBe('2 hours');
    });

    it('formats combined hours, minutes, seconds', () => {
      const duration = (1 * 60 * 60 + 2 * 60 + 3) * 1000;
      const result = formatMsDuration(duration);
      expect(result).toContain('1 hour');
      expect(result).toContain('2 minutes');
      expect(result).toContain('3 seconds');
    });

    it('formats combined minutes, seconds and ms', () => {
      const duration = 2 * 60 * 1000 + 30 * 1000 + 250;
      const result = formatMsDuration(duration);
      expect(result).toContain('2 minutes');
      expect(result).toContain('30 seconds');
      expect(result).toContain('250 ms');
    });

    it('does not include ms when duration is exact seconds', () => {
      const result = formatMsDuration(10000);
      expect(result).not.toContain('ms');
    });
  });
});
