// The form of every sign-out button: a plain POST to the sign-out route
// (`app/sign-out/route.ts`), which answers with a full load of the home page.
export function SignOutForm({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form method="post" action="/sign-out" className={className}>
      {children}
    </form>
  );
}
