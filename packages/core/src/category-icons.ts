// the built in pictures a category can have instead of a photo. drawn on the app's icon grid
// (24 px, round caps and joins, 1.8 stroke) so web, email and any later app render the same
// shapes. the keys are stored in the database, so a key is never renamed, only added.

export interface CategoryIconShape {
  paths: string[];
  circles?: [cx: number, cy: number, r: number][];
}

export const CATEGORY_ICONS = {
  bottle: {
    paths: ['M10 2.5h4', 'M10.5 2.5v4.2c0 .6-.3 1.1-.8 1.5C8.6 9 8 10.3 8 11.7V20a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 20v-8.3c0-1.4-.6-2.7-1.7-3.5-.5-.4-.8-.9-.8-1.5V2.5', 'M8 14h8'],
  },
  jar: {
    paths: ['M7.5 3.5h9v3h-9z', 'M7 8.5c-1 .9-1.5 2-1.5 3.3V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7.2c0-1.3-.5-2.4-1.5-3.3z', 'M8.5 13h7v4h-7z'],
  },
  cheese: {
    paths: ['M3 15 14 6.5l7 3.5v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M3 15h18'],
    circles: [[8.5, 16.6, 0.9], [15, 16.8, 0.7], [14, 11.2, 0.8]],
  },
  bread: {
    paths: ['M4 11.5C4 8.5 7.6 6 12 6s8 2.5 8 5.5c0 1-.6 1.8-1.5 2V18a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 18v-4.5c-.9-.2-1.5-1-1.5-2z', 'm9.5 9.5 1 2', 'm13.5 9.5 1 2'],
  },
  fruit: {
    paths: ['M12 7.5c-1.5-1-5.5-1.6-6.8 2.2-1.2 3.4.8 8.6 3.6 10.3 1.1.7 2.1.3 3.2-.1 1.1.4 2.1.8 3.2.1 2.8-1.7 4.8-6.9 3.6-10.3C17.5 5.9 13.5 6.5 12 7.5z', 'M12 7.5c0-1.8.6-3.2 2-4.5', 'M12.5 5c1.6-.9 3.3-.8 4.5 0-1.2 1.3-3 1.5-4.5 0z'],
  },
  vegetable: {
    paths: ['M6.2 19.8c-.9.9-2.5-.7-1.6-1.6l8.6-11 3.6 3.6z', 'M14.5 7.5 16 3', 'M16.5 9.5 21 8', 'M15.5 8.5 19 5', 'm8.5 15.5 1.5 1.5', 'm10.5 12.5 1.5 1.5'],
  },
  coffee: {
    paths: ['M5 9.5h11v5.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 11h1.5a2.5 2.5 0 0 1 0 5H16', 'M9 3.5c-.8.9-.8 1.9 0 2.8', 'M12.5 3.5c-.8.9-.8 1.9 0 2.8'],
  },
  wine: {
    paths: ['M7.5 3h9l-.6 5.2a4 4 0 0 1-3.9 3.6 4 4 0 0 1-3.9-3.6z', 'M12 11.8V20', 'M8.5 20.5h7', 'M8 7h8'],
  },
  milk: {
    paths: ['M8 8.5 10 3.5h4l2 5V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z', 'M8 8.5h8', 'M10.5 13h3v4h-3z'],
  },
  fish: {
    paths: ['M20.5 12c-2-3.2-4.6-4.8-7.8-4.8-3.3 0-6 1.6-8.2 4.8 2.2 3.2 4.9 4.8 8.2 4.8 3.2 0 5.8-1.6 7.8-4.8z', 'M4.5 12 2 9v6z'],
    circles: [[16.2, 11.2, 0.8]],
  },
  meat: {
    paths: ['M6 9.5C7 6 10.5 4 14 4.5s6 3.2 5.5 6.7c-.4 3-3 4.4-5.2 5.5-2 1-3 2.3-4.3 3.5-1.6 1.5-4.3.7-5-1.4-.5-1.5.2-2.6.6-4 .4-1.4-.1-2.7.4-5.3z'],
    circles: [[14, 10.5, 2]],
  },
  sweets: {
    paths: ['M7.9 10.9 3.5 8v8l4.4-2.9', 'M16.1 10.9 20.5 8v8l-4.4-2.9'],
    circles: [[12, 12, 4.2]],
  },
  leaf: {
    paths: ['M5 19c0-8 5-14 15-14 0 10-6 15-14 15', 'm5 19 7-7'],
  },
  gift: {
    paths: ['M4 10h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 7h18v3H3z', 'M12 7v14', 'M12 7c-1.5-3.5-5.5-3.8-5.5-1.3C6.5 7 9 7 12 7z', 'M12 7c1.5-3.5 5.5-3.8 5.5-1.3 0 1.3-2.5 1.3-5.5 1.3z'],
  },
  box: {
    paths: ['M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z', 'M3.5 7.5 12 12l8.5-4.5M12 12v9'],
  },
  tag: {
    paths: ['M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-8.1 8.1a1 1 0 0 1-1.4 0l-7.4-7.4a1 1 0 0 1-.3-.7z'],
    circles: [[8, 8, 1.5]],
  },
} as const satisfies Record<string, CategoryIconShape>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

export function isCategoryIconKey(v: unknown): v is CategoryIconKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, v);
}

// the shape for a stored key, null for an unknown one (a key from a newer version, or none)
export function categoryIcon(key: string | null | undefined): CategoryIconShape | null {
  return isCategoryIconKey(key) ? CATEGORY_ICONS[key] : null;
}
