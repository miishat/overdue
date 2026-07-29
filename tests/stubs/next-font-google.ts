// next/font/google is a compile-time construct: the Next.js SWC transform
// rewrites these calls at build time, so the real module is not callable
// under plain Vitest. This stub mirrors the shape the loaders return so
// font-consuming modules can be unit tested.
interface FontOptions {
  variable?: string;
}

interface FontResult {
  variable: string;
  className: string;
  style: { fontFamily: string };
}

function stubLoader(family: string) {
  return (options: FontOptions = {}): FontResult => ({
    variable: options.variable ?? `--font-${family}`,
    className: `__${family}`,
    style: { fontFamily: family },
  });
}

export const Newsreader = stubLoader("newsreader");
export const Instrument_Sans = stubLoader("instrument-sans");
export const IBM_Plex_Mono = stubLoader("ibm-plex-mono");
