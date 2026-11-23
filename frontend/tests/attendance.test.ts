import { describe, expect, it } from 'vitest';
import { checkedTier, getTier, percent } from '../src/attendance';

describe('attendance display', () => {
  it.each([
    [59.99, 'Critical'],
    [60, 'Warning'],
    [74.99, 'Warning'],
    [75, 'Satisfactory'],
    [89.99, 'Satisfactory'],
    [90, 'Excellent'],
  ])('classifies %s as %s', (value, tier) =>
    expect(getTier(value as number)).toBe(tier),
  );

  it('preserves the backend value at two decimal places and hides a disagreeing tier', () => {
    expect(percent(75)).toBe('75.00%');
    expect(checkedTier(75, 'Warning')).toBe('Pending check');
    expect(checkedTier(75, 'Satisfactory')).toBe('Satisfactory');
  });
});
