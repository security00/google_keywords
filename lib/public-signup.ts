export const PUBLIC_SIGNUP_TRIAL_DAYS = 14;
export const INVITE_SIGNUP_TRIAL_DAYS = 90;

export const isPublicSignupEnabled = (): boolean =>
  String(
    process.env.NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED ??
      process.env.PUBLIC_SIGNUP_ENABLED ??
      ""
  ).trim() === "true";

export const publicSignupCta = (): string =>
  isPublicSignupEnabled() ? "Start free trial" : "Request access";
