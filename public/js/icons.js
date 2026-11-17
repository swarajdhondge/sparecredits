// Inline SVG icons from the style E design. Stroke and size come from the .cm svg rule in cm.css.
const svg = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;

export const ICON_SEARCH = svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>');
export const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
export const ICON_BACK = svg('<path d="M15 5l-7 7 7 7"/>');
export const ICON_NEXT = svg('<path d="M9 5l7 7-7 7"/>');
export const ICON_TURN_LEFT = svg('<path d="M4.5 13a7.5 7.5 0 1 0 2.2-6.3"/><path d="M4 4v4.5h4.5"/>');
export const ICON_TURN_RIGHT = svg('<path d="M19.5 13a7.5 7.5 0 1 1-2.2-6.3"/><path d="M20 4v4.5h-4.5"/>');
export const ICON_WHOLE_TOWN = svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/>');
export const ICON_ZOOM_IN = svg('<path d="M12 6v12M6 12h12"/>');
export const ICON_ZOOM_OUT = svg('<path d="M6 12h12"/>');
export const ICON_LIKE = svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>');
export const ICON_SHARE = svg('<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>');
export const ICON_DONE = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
export const ICON_ARROW = svg('<path d="M5 12h14M13 6l6 6-6 6"/>');
export const ICON_CRATE = svg('<path d="M4 8l8-4 8 4v8l-8 4-8-4z" style="fill:var(--accent)"/><path d="M4 8l8 4 8-4M12 12v8"/>');
