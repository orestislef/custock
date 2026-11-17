// commissioner (latin, greek, cyrillic) for display moments only. until it loads, the system font
// is used, which also covers all three scripts.

import { useFonts } from 'expo-font';
import { createContext, useContext } from 'react';

export const DisplayFontContext = createContext(false);

export function useDisplayFontReady(): boolean {
  return useContext(DisplayFontContext);
}

// bold cut only: display moments are titles and big numbers. ofl licensed, see assets/fonts/OFL.txt
const FONT_MAP: Record<string, number> = { Commissioner: require('../../assets/fonts/Commissioner-Bold.ttf') };

export function useLoadDisplayFont(): boolean {
  const [loaded] = useFonts(FONT_MAP);
  return loaded && Object.keys(FONT_MAP).length > 0;
}
