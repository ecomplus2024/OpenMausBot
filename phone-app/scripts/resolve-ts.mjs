// Node ESM resolver hook: the app's TS sources import without extensions
// (Metro resolves them); Node does not, so retry with .ts appended.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        return await next(`${specifier}.ts`, context);
      } catch {
        /* fall through to the original error */
      }
      try {
        return await next(`${specifier}.tsx`, context);
      } catch {
        /* same */
      }
    }
    throw error;
  }
}
