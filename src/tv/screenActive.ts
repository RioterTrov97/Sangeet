import { createContext, useContext } from 'react';

/** False for a kept-alive root screen that is hidden under another screen: it must not take Back presses or other global input. */
export const ScreenActive = createContext(true);
export const useScreenActive = (): boolean => useContext(ScreenActive);
