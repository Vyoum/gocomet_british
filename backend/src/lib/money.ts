/** Money is stored as integer minor units (paise/cents); the API speaks decimal amounts. */
export const toMinor = (amount: number): number => Math.round(amount * 100);
export const fromMinor = (minor: number): number => minor / 100;
