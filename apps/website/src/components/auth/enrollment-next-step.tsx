export function EnrollmentNextStep({ role }: { role: string }) {
  if (role === "USER")
    return (
      <>
        <p>
          Resident access is in the OPA mobile app. On your phone, open the
          installed app and sign in with the password you just established.
        </p>
        <a href="opa://login">Open OPA app to sign in</a>
        <p>
          If the app does not open, launch OPA on your phone. If it is not
          installed, ask your institution for its approved installation
          instructions. There is no resident web portal here.
        </p>
      </>
    );
  const target: Record<string, { href: string; label: string }> = {
    ADMIN: { href: "/super-admin/login", label: "Sign in to Super Admin" },
    FACILITY_OPERATOR: {
      href: "/operator/login",
      label: "Sign in to Operator Command Center",
    },
    FACILITY_ADMIN: {
      href: "/institutional",
      label: "Sign in to Facility Admin workspace",
    },
    TECHNICAL_SUPPORT: {
      href: "/institutional",
      label: "Sign in to OPA Support Console",
    },
  };
  const next = target[role];
  return next ? (
    <a href={next.href}>{next.label}</a>
  ) : (
    <p>Contact your administrator for the correct sign-in destination.</p>
  );
}
