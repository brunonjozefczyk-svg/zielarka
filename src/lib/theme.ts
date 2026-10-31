export const FONT_STACKS = {
  fraunces: '"Fraunces", "Iowan Old Style", "Palatino Linotype", serif',
  figtree: '"Figtree", "Source Sans 3", ui-sans-serif, system-ui, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, serif',
  sans: "ui-sans-serif, system-ui, sans-serif",
} as const;

export type FontChoice = keyof typeof FONT_STACKS;
export type TextFont = "display" | "body" | "serif" | "sans";
export type TextSize = "sm" | "md" | "lg";
export type FontWeight = 400 | 500 | 600 | 700;

export type ThemeSettings = {
  display: FontChoice;
  body: FontChoice;
  h1: number | null;
  h2: number | null;
  h3: number | null;
  bodySize: number | null;
  headingWeight: FontWeight | null;
  bodyWeight: FontWeight | null;
  leading: number | null;
};

export type TextStyle = {
  font?: TextFont;
  size?: TextSize;
  bold?: boolean;
  italic?: boolean;
};

/** Form state that means "leave the current site alone". Saving it stores null. */
export const UNSET_THEME: ThemeSettings = {
  display: "fraunces",
  body: "figtree",
  h1: null,
  h2: null,
  h3: null,
  bodySize: null,
  headingWeight: null,
  bodyWeight: null,
  leading: null,
};

const WEIGHTS = new Set<FontWeight>([400, 500, 600, 700]);

function clamp(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number * 100) / 100));
}

function optionalSize(value: unknown, min: number, max: number) {
  if (value == null || value === "") return null;
  return clamp(value, min, max);
}

function optionalWeight(value: unknown): FontWeight | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return WEIGHTS.has(number as FontWeight) ? (number as FontWeight) : null;
}

export function sanitizeTheme(input: unknown): ThemeSettings | null {
  if (input == null) return null;
  if (typeof input !== "object") return null;
  const raw = input as Partial<ThemeSettings>;
  if (typeof raw.display !== "string" || !(raw.display in FONT_STACKS)) return null;
  if (typeof raw.body !== "string" || !(raw.body in FONT_STACKS)) return null;
  const theme: ThemeSettings = {
    display: raw.display as FontChoice,
    body: raw.body as FontChoice,
    h1: optionalSize(raw.h1, 2, 4.5),
    h2: optionalSize(raw.h2, 1.4, 3),
    h3: optionalSize(raw.h3, 1.1, 2.2),
    bodySize: optionalSize(raw.bodySize, 0.9, 1.3),
    headingWeight: optionalWeight(raw.headingWeight),
    bodyWeight: optionalWeight(raw.bodyWeight),
    leading: optionalSize(raw.leading, 1.3, 1.9),
  };
  if (
    theme.display === UNSET_THEME.display &&
    theme.body === UNSET_THEME.body &&
    theme.h1 == null &&
    theme.h2 == null &&
    theme.h3 == null &&
    theme.bodySize == null &&
    theme.headingWeight == null &&
    theme.bodyWeight == null &&
    theme.leading == null
  ) {
    return null;
  }
  return theme;
}

export function themeVars(theme: ThemeSettings | null): Record<string, string> | undefined {
  if (!theme) return undefined;
  const vars: Record<string, string> = {
    "--zl-display": FONT_STACKS[theme.display],
    "--zl-body": FONT_STACKS[theme.body],
  };
  if (theme.h1 != null) vars["--zl-h1"] = `${theme.h1}rem`;
  if (theme.h2 != null) vars["--zl-h2"] = `${theme.h2}rem`;
  if (theme.h3 != null) vars["--zl-h3"] = `${theme.h3}rem`;
  if (theme.bodySize != null) vars["--zl-body-size"] = `${theme.bodySize}rem`;
  if (theme.headingWeight != null) vars["--zl-heading-weight"] = String(theme.headingWeight);
  if (theme.bodyWeight != null) vars["--zl-body-weight"] = String(theme.bodyWeight);
  if (theme.leading != null) vars["--zl-leading"] = String(theme.leading);
  return vars;
}

export function themeAttrs(theme: ThemeSettings | null): Record<string, string | undefined> {
  if (!theme) {
    return {
      "data-theme": undefined,
      "data-size-h1": undefined,
      "data-size-h2": undefined,
      "data-size-h3": undefined,
      "data-size-body": undefined,
      "data-w-heading": undefined,
      "data-w-body": undefined,
      "data-leading": undefined,
    };
  }
  return {
    "data-theme": "custom",
    "data-size-h1": theme.h1 != null ? "" : undefined,
    "data-size-h2": theme.h2 != null ? "" : undefined,
    "data-size-h3": theme.h3 != null ? "" : undefined,
    "data-size-body": theme.bodySize != null ? "" : undefined,
    "data-w-heading": theme.headingWeight != null ? "" : undefined,
    "data-w-body": theme.bodyWeight != null ? "" : undefined,
    "data-leading": theme.leading != null ? "" : undefined,
  };
}

export function sanitizeStyle(input: unknown): TextStyle | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as TextStyle;
  const style: TextStyle = {};
  if (raw.font === "display" || raw.font === "body" || raw.font === "serif" || raw.font === "sans") {
    style.font = raw.font;
  }
  if (raw.size === "sm" || raw.size === "md" || raw.size === "lg") style.size = raw.size;
  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  return style.font || style.size || style.bold || style.italic ? style : null;
}

export function sanitizeStyles(input: unknown): Record<string, TextStyle> {
  if (!input || typeof input !== "object") return {};
  const styles: Record<string, TextStyle> = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z0-9.-]{1,80}$/i.test(id)) continue;
    const style = sanitizeStyle(value);
    if (style) styles[id] = style;
  }
  return styles;
}

export function textInline(style: TextStyle | null | undefined): Record<string, string | number> | undefined {
  if (!style) return undefined;
  const css: Record<string, string | number> = {};
  if (style.font === "display") css.fontFamily = "var(--font-display)";
  if (style.font === "body") css.fontFamily = "var(--font-sans)";
  if (style.font === "serif") css.fontFamily = FONT_STACKS.serif;
  if (style.font === "sans") css.fontFamily = FONT_STACKS.sans;
  if (style.size === "sm") css.fontSize = "0.875rem";
  if (style.size === "md") css.fontSize = "1rem";
  if (style.size === "lg") css.fontSize = "1.25rem";
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = "italic";
  return Object.keys(css).length ? css : undefined;
}
