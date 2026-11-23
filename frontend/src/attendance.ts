import type { Tier } from './types';
const thresholds = { excellent: 90, satisfactory: 75, warning: 60 };
export const MIN_STUDENTS_FOR_STATS = 5;
export function getTier(percentage: number): Tier {
  if (percentage >= thresholds.excellent) return 'Excellent';
  if (percentage >= thresholds.satisfactory) return 'Satisfactory';
  if (percentage >= thresholds.warning) return 'Warning';
  return 'Critical';
}
export function checkedTier(percentage: number, serverTier?: Tier) {
  const tier = getTier(percentage);
  return serverTier && serverTier !== tier ? 'Pending check' : tier;
}
export const percent = (value: number) => value.toFixed(2) + '%';
export const dateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
