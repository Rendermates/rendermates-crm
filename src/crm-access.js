// The browser only identifies the signed-in account. Firestore rules enforce access.
export function googleIdentity(claims) {
  if (claims?.firebase?.sign_in_provider !== 'google.com' ||
      claims.email_verified !== true ||
      typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
  return claims.email.toLowerCase();
}

export function accessErrorMessage(code) {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled. Please try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this CRM and try again.';
    case 'auth/unauthorized-domain':
      return 'This CRM address has not been authorized for Google sign-in. Contact your administrator.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in has not been enabled for this CRM. Contact your administrator.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'A secure connection could not be established. Check your connection and try again.';
    default:
      return 'Access could not be verified. Please try again or contact your administrator.';
  }
}
