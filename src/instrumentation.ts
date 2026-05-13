/**
 * Next.js Instrumentation
 *
 * This file is automatically executed when the server starts
 * Used to initialize various application subsystems
 *
 * Reference: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Important: This file is compiled into two versions (Node.js and Edge Runtime)
 * - Must dynamically import Node.js modules at runtime, not at top-level
 * - Edge Runtime does not support Node.js modules (like 'os', 'fs', 'pino', etc.)
 */

/**
 * register() function is called once when Next.js server starts
 *
 * Note: This function only executes on the server-side, not on the client-side
 */
export async function register() {
  // Initialize only in Node.js runtime
  // Edge Runtime skips this code block to avoid importing Node.js modules
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import to avoid importing in Edge Runtime compilation
    const { initializeApplication } = await import('@/lib/_core/init');
    await initializeApplication();
  }
}
