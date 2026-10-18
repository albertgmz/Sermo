// The address password managers open to change a member's password (W3C "A Well-Known URL for
// Changing Passwords"): it sends the browser on to the password form of the account's security
// page, which asks a visitor who is not signed in to sign in first. A file of the site, outside the
// language segment: the page is drawn in the visitor's language. The address it sends to is
// relative, so it holds whatever host the site is reached by.
export function GET() {
  return new Response(null, {
    status: 302,
    headers: { location: "/account/security#password" },
  });
}
