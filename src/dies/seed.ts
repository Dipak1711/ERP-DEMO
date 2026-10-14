import type { DieData } from './types';

// The Die Management module starts empty: no main dies, no dies, no history. Everything is entered by the user.
export const emptyDieData = (): DieData => ({
  mainDies: [],
  forgingDies: [],
  trimmingDies: [],
  history: [],
  maintenance: [],
  issues: [],
  images: {},
});
