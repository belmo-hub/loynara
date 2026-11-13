// Finds design values that bypass src/styles/tokens.css (DESIGN.md: nothing else defines a colour, font size, weight,
// radius or layer) and spacing off the 4 px scale (SF-7). It reads declarations, not text: shorthands (`font`), corner radii,
// custom-property indirection, inline style objects in .tsx and CSS embedded in strings are all checked, and comments are
// ignored. Used by raw-values.test.ts.

export type Kind = "colour" | "font size" | "weight" | "radius" | "layer" | "spacing";
export type Finding = { file: string; selector: string; property: string; value: string; kind: Kind };
/** One allowed finding. Every given field must match; `selectors` lists the exact selectors of the rule. */
export type Exception = { file: string; kind: Kind; selectors?: string[]; property?: string; value?: string; reason: string };

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black)\b/i;
const ABSOLUTE_SIZE = /(?<![\w.#-])(?:\d+\.?\d*|\.\d+)(?:px|rem|pt)\b/;
const NONZERO_PX = /(?<![\w.#-])(?:\d*\.\d*[1-9]|[1-9]\d*\.?\d*)px\b/;
// DESIGN.md: weights are four tokens and nothing else.
const WEIGHT_TOKEN = /^var\(\s*--weight-(?:body|label|strong|heavy)\s*\)$/;
const RADIUS_PROPERTY = /^border(?:-[a-z]+)*-radius$/;
const SPACING_PROPERTY = /^(?:margin|padding)(?:-[a-z]+)*$|^(?:row-|column-)?gap$/;
// A pixel length that is not a multiple of 4. Negative offsets are optical alignment (a chevron's own padding), not spacing.
const OFF_SCALE = (value: string) => [...value.matchAll(/(?<![\w.#-])(\d*\.?\d+)px\b/g)].some(match => Number(match[1]) % 4 !== 0);

const varsIn = (value: string) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The kinds a declaration violates. `tokens` are the custom properties defined in tokens.css. */
export function checkDeclaration(property: string, value: string, tokens: ReadonlySet<string>): Kind[] {
  const kinds: Kind[] = [];
  const prop = property.trim().toLowerCase(), val = value.trim().replace(/url\([^)]*\)/g, "url()");
  if (COLOUR.test(val)) kinds.push("colour");
  if (prop === "font-size" || prop === "font") {
    const foreign = varsIn(val).some(name => !tokens.has(name) && !/^--(text|display|font|weight|leading)-/.test(name));
    if (ABSOLUTE_SIZE.test(val) || foreign) kinds.push("font size");
  }
  if (prop === "font-weight" && val !== "inherit" && !WEIGHT_TOKEN.test(val)) kinds.push("weight");
  if (prop === "font" && /^(?:\d{1,4}|bold|bolder|lighter)\b/.test(val)) kinds.push("weight");
  if (RADIUS_PROPERTY.test(prop)) {
    if (NONZERO_PX.test(val) || varsIn(val).some(name => !name.startsWith("--radius-"))) kinds.push("radius");
  }
  if (SPACING_PROPERTY.test(prop) && OFF_SCALE(val)) kinds.push("spacing");
  if (prop === "z-index" && !/^(auto|0|-1|inherit)$/.test(val)) {
    const names = varsIn(val);
    if (!names.length || names.some(name => !name.startsWith("--z-"))) kinds.push("layer");
  }
  return kinds;
}

/** Every declaration of every rule, with the rule's selector; nested at-rules are walked through. */
export function cssDeclarations(css: string): Array<{ selector: string; property: string; value: string }> {
  const out: Array<{ selector: string; property: string; value: string }> = [];
  for (const block of stripComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, " ");
    for (const declaration of block[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      out.push({ selector, property: declaration.slice(0, colon).trim(), value: declaration.slice(colon + 1).trim() });
    }
  }
  return out;
}

export function cssFindings(file: string, css: string, tokens: ReadonlySet<string>): Finding[] {
  return cssDeclarations(css).flatMap(({ selector, property, value }) =>
    checkDeclaration(property, value, tokens).map(kind => ({ file, selector, property, value, kind })));
}

const STYLE_KEYS: Record<string, string> = {
  fontSize: "font-size", fontWeight: "font-weight", font: "font", zIndex: "z-index", color: "color", background: "background", backgroundColor: "background-color",
  borderColor: "border-color", outlineColor: "outline-color", fill: "fill", stroke: "stroke", boxShadow: "box-shadow",
  borderRadius: "border-radius", borderTopLeftRadius: "border-top-left-radius", borderTopRightRadius: "border-top-right-radius",
  borderBottomLeftRadius: "border-bottom-left-radius", borderBottomRightRadius: "border-bottom-right-radius",
  ...Object.fromEntries(["margin", "padding"].flatMap(side => ["", "Top", "Right", "Bottom", "Left", "Block", "Inline", "BlockStart", "BlockEnd", "InlineStart", "InlineEnd"]
    .map(edge => [side + edge, `${side}${edge.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`]))),
  gap: "gap", rowGap: "row-gap", columnGap: "column-gap",
};

/**
 * Inline style objects (`fontSize: 14`, `fontSize : "14px"`, `zIndex: 3` …) and CSS written inside string or template
 * literals. A bare number in a style object means pixels. Expressions that are not literals are not judged.
 */
export function sourceFindings(file: string, source: string, tokens: ReadonlySet<string>): Finding[] {
  const code = source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const findings: Finding[] = [];
  // Style objects are looked for outside CSS strings (those are read as CSS below).
  // Strings are taken whole from left to right, so the span between two attributes' quotes is never read as one string.
  const blank = (quote: string) => (text: string) => /[;{]/.test(text) ? quote + quote : text;
  const objects = code.replace(/`[^`]*`/g, "``").replace(/"[^"\n]*"/g, blank('"')).replace(/'[^'\n]*'/g, blank("'"));
  for (const match of objects.matchAll(/\b([a-zA-Z]+)\s*:\s*(-?\d+(?:\.\d+)?\b(?!\s*[?:])|"[^"\n]*"|'[^'\n]*'|`[^`$]*`)/g)) {
    const property = STYLE_KEYS[match[1]];
    if (!property) continue;
    const literal = match[2];
    const value = /^-?\d/.test(literal) ? (property === "z-index" || property === "font-weight" ? literal : `${literal}px`) : literal.slice(1, -1);
    if (/^-?\d/.test(literal) && Number(literal) === 0) continue;
    // Inline spacing is raw whatever its size: it belongs in a class or a parent's gap (SF-7). Tokens and 0 pass.
    if (SPACING_PROPERTY.test(property)) {
      if (/\d/.test(value.replace(/var\([^)]*\)/g, "").replace(/(?<![\w.])0(?![\w.])/g, ""))) findings.push({ file, selector: "style", property, value, kind: "spacing" });
      continue;
    }
    for (const kind of checkDeclaration(property, value, tokens)) findings.push({ file, selector: "style", property, value, kind });
  }
  // CSS inside string or template literals: anything that holds a declaration block or a run of declarations.
  for (const match of code.matchAll(/`([^`]*)`|"([^"\n]*)"|'([^'\n]*)'/g)) {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    if (!/[a-z-]+\s*:\s*[^;]+;/.test(text) || !/(?:^|[;{\s])(?:color|background|font|font-size|font-weight|border(?:-[a-z]+)*-radius|z-index|--[\w-]+)\s*:/.test(text)) continue;
    const css = text.includes("{") ? text : `string { ${text} }`;
    findings.push(...cssFindings(file, css, tokens));
  }
  return findings;
}

/** Splits findings into those an exception allows (counting each exception's use) and the rest. */
export function applyExceptions(findings: Finding[], exceptions: Exception[]) {
  const used = new Map<Exception, number>(exceptions.map(exception => [exception, 0]));
  const rest = findings.filter(finding => {
    const allowedBy = exceptions.find(exception => exception.file === finding.file && exception.kind === finding.kind
      && (!exception.property || exception.property === finding.property)
      && (!exception.value || finding.value.includes(exception.value))
      && (!exception.selectors || finding.selector.split(",").every(part => exception.selectors!.includes(part.trim()))));
    if (allowedBy) used.set(allowedBy, used.get(allowedBy)! + 1);
    return !allowedBy;
  });
  return { rest, unused: exceptions.filter(exception => used.get(exception) === 0) };
}
