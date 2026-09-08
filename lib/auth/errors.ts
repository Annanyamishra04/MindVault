import {
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
  type AuthError,
} from "@supabase/supabase-js";

/**
 * Maps Supabase Auth error codes to user-facing copy.
 *
 * Deliberately generic where precision would leak account information
 * (e.g. we don't distinguish "wrong password" from "no such user" —
 * Supabase itself collapses both into `invalid_credentials` for this
 * reason) and deliberately specific where the user needs to *act*
 * differently (e.g. an existing account should be told to log in
 * instead of staring at a stuck form).
 */
const FRIENDLY_MESSAGES: Partial<Record<string, string>> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed: "Please confirm your email address before logging in.",
  user_already_exists: "An account with this email already exists. Try logging in instead.",
  email_exists: "An account with this email already exists. Try logging in instead.",
  weak_password: "That password is too weak. Please choose a stronger one.",
  email_address_invalid: "That doesn't look like a valid email address.",
  email_address_not_authorized: "That email address can't be used to sign up.",
  over_email_send_rate_limit: "Too many attempts. Please wait a few minutes and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a few minutes and try again.",
  signup_disabled: "New sign-ups are currently disabled.",
  same_password: "Your new password must be different from your current one.",
  user_banned: "This account is no longer active.",
  session_expired: "Your session has expired. Please log in again.",
  refresh_token_not_found: "Your session has expired. Please log in again.",
  validation_failed: "Please check your details and try again.",
};

/**
 * Converts any error thrown by a Supabase Auth call into a short,
 * user-safe message — never the raw provider message (which can
 * include implementation detail we don't want to expose) and never a
 * stack trace.
 *
 * Auth-js does NOT put every error under `AuthApiError` — weak-password
 * and retryable-network failures are their own subclasses with their
 * own `.name`, so checking `isAuthApiError` alone silently misses them
 * and falls through to the generic fallback message. Each subclass is
 * checked explicitly for that reason.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return "Couldn't reach the authentication service. Check your connection and try again.";
  }

  if (isAuthWeakPasswordError(error)) {
    return "That password is too weak. Please choose a stronger one.";
  }

  if (isAuthApiError(error) || isAuthError(error)) {
    const code = (error as AuthError).code;
    if (code && FRIENDLY_MESSAGES[code]) {
      return FRIENDLY_MESSAGES[code];
    }
    const status = (error as AuthError).status;
    if (status === 400) {
      return "That didn't work — please check your details and try again.";
    }
    if (status && status >= 500) {
      return "The authentication service is temporarily unavailable. Please try again shortly.";
    }
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network/i.test(error.message))
  ) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  return "Something went wrong. Please try again.";
}
