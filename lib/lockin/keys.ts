/** Where lock in remembers things in the browser. Plain module (no "use client"), so the root layout can read the boot script. */
export const MODE_KEY = "margin:mode";
export const HINT_KEY = "margin:lock-in-hint-seen";
export const TIMER_KEY = "margin:focus-timer";
export const LAST_LENGTH_KEY = "margin:focus-last-minutes";

/** Runs before the first paint: puts lock in back on <html> if it was the last mode used. */
export const BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(MODE_KEY)})==="lock-in")document.documentElement.setAttribute("data-lockin","")}catch(e){}`;
