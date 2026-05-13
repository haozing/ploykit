/**
 * Better Auth Client Configuration
 *
 * This file can be used on both client and server side
 *
 * Provides:
 * - React Hooks (useSession, useUser, etc.)
 * - Authentication methods (signIn, signUp, signOut, etc.)
 */

'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth Client Instance
 */
export const authClient = createAuthClient({
  // Use same-origin API calls by default. Absolute public URLs are build-time
  // values in Next.js client bundles and break local/proxy ports after build.
  baseURL: '',

  plugins: [],
});

//
// Export all Hooks and Methods
//

/**
 * Session Hook
 *
 * Get current session information (user, session)
 *
 * @example
 * const { data: session, isPending, error } = useSession();
 * if (session) {
 *   console.log(session.user); // Current user
 *   console.log(session.session); // Session info
 * }
 */
export const useSession = authClient.useSession;

//
// Authentication Methods
//

/**
 * Email/Password Login
 *
 * @example
 * await signIn.email({
 *   email: "user@example.com",
 *   password: "password123",
 *   callbackURL: "/dashboard",
 * });
 */
export const signIn = authClient.signIn;

/**
 * Email/Password Registration
 *
 * @example
 * await signUp.email({
 *   email: "user@example.com",
 *   password: "password123",
 *   name: "John Doe",
 *   callbackURL: "/dashboard",
 * });
 */
export const signUp = authClient.signUp;

/**
 * Sign Out
 *
 * @example
 * await signOut();
 */
export const signOut = authClient.signOut;

/**
 * Forgot Password
 *
 * @example
 * await forgetPassword({
 *   email: "user@example.com",
 *   redirectTo: "/reset-password",
 * });
 */
export const forgetPassword = authClient.forgetPassword;

/**
 * Reset Password
 *
 * @example
 * await resetPassword({
 *   newPassword: "newpassword123",
 * });
 */
export const resetPassword = authClient.resetPassword;

//
// Type Exports
//

/**
 * Session Type
 */
export type Session = typeof authClient.$Infer.Session;

/**
 * User Type
 */
export type User = Session['user'];
