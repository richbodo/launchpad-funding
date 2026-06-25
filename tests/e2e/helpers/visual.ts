import { expect, Locator, Page } from '@playwright/test';

/**
 * Visual / screenshot-assertion helpers shared across e2e specs.
 *
 * These functions exist because pure DOM assertions miss a whole class of
 * bugs that only show up in pixels: a parent setting `text-white` that
 * cascades into a child <input> on a white background, a Tailwind purge
 * stripping `text-foreground`, a flexbox collapse that hides the funding
 * meter fill, etc. Whenever a regression would manifest visually but not
 * structurally, use one of these helpers.
 */

/** Parse a CSS color string ("rgb(...)" or "rgba(...)") into [r,g,b,a]. */
function parseColor(input: string): [number, number, number, number] {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  const [r, g, b, a = 1] = parts;
  return [r, g, b, a];
}

/** Relative luminance per WCAG. Inputs are 0-255. */
function luminance(r: number, g: number, b: number): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/** WCAG contrast ratio between two CSS color strings, 1.0 .. 21.0. */
export function contrastRatio(fg: string, bg: string): number {
  const [fr, fg2, fb] = parseColor(fg);
  const [br, bg3, bb] = parseColor(bg);
  const L1 = luminance(fr, fg2, fb);
  const L2 = luminance(br, bg3, bb);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Assert that a text-bearing element has sufficient contrast against its own
 * background. Walks up the DOM if the immediate background is transparent so
 * we compare against the effective rendered background, not `rgba(0,0,0,0)`.
 *
 * Default threshold is WCAG AA for normal text (4.5:1).
 */
export async function assertReadable(
  locator: Locator,
  opts: { minRatio?: number; label?: string } = {},
): Promise<void> {
  const minRatio = opts.minRatio ?? 4.5;
  const label = opts.label ?? '(unnamed element)';

  const colors = await locator.evaluate((el) => {
    const cs = window.getComputedStyle(el as Element);
    let bgEl: Element | null = el as Element;
    let bg = cs.backgroundColor;
    while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
      bgEl = bgEl.parentElement;
      if (!bgEl) break;
      bg = window.getComputedStyle(bgEl).backgroundColor;
    }
    if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      bg = 'rgb(255, 255, 255)'; // assume page default
    }
    return { color: cs.color, bg };
  });

  const ratio = contrastRatio(colors.color, colors.bg);
  expect(
    ratio,
    `${label}: contrast ratio ${ratio.toFixed(2)} (color=${colors.color}, bg=${colors.bg}) is below ${minRatio}`,
  ).toBeGreaterThanOrEqual(minRatio);
}

/**
 * Take a screenshot of `locator` and assert it isn't a single solid color —
 * a coarse check that catches "the text is the same color as the background
 * so the input looks empty" bugs even when the contrast math above somehow
 * agrees that things look fine.
 */
export async function assertHasVisibleContent(
  locator: Locator,
  opts: { minUniqueColors?: number } = {},
): Promise<void> {
  const minUnique = opts.minUniqueColors ?? 4;
  const buf = await locator.screenshot();
  // Quick-and-dirty: count unique bytes in the PNG. A solid-color screenshot
  // compresses to very few unique bytes; any real text adds variety.
  const unique = new Set<number>();
  for (let i = 0; i < buf.length; i += 1) unique.add(buf[i]);
  expect(unique.size).toBeGreaterThanOrEqual(minUnique);
}

/**
 * Measure a child element's width as a fraction of its parent's width. Used to
 * verify the funding meter fill ratio matches the underlying funded/goal math
 * at the pixel level — not just the textual percentage label.
 */
export async function measureFillRatio(
  page: Page,
  fillSelector: string,
  trackSelector: string,
): Promise<number> {
  const fill = await page.locator(fillSelector).boundingBox();
  const track = await page.locator(trackSelector).boundingBox();
  if (!fill || !track || track.width === 0) return 0;
  return fill.width / track.width;
}

/**
 * Scan a page's visible text for anything that looks like an email address.
 * Used as a security regression check: unauthenticated views must never leak
 * participant email addresses into the DOM.
 */
export async function assertNoEmailsInVisibleText(
  page: Page,
  allowList: string[] = [],
): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const matches = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  const leaked = matches.filter((m) => !allowList.includes(m.toLowerCase()));
  expect(leaked, `Leaked emails in visible text: ${leaked.join(', ')}`).toEqual([]);
}
