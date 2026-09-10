import { LogoMark } from "@/components/brand/Logo";
import LoginForm from "./login-form";
export default function Login() {
  return (
    <main className="sa-login">
      <div className="sa-brand">
        <LogoMark size={40} />
        <span>OPA / Platform</span>
      </div>
      <div className="sa-card">
        <div className="sa-eyebrow">Restricted access</div>
        <h1>Super Admin</h1>
        <p>
          Sign in with your platform administrator account to manage facilities
          and provision operator access.
        </p>
        <LoginForm />
      </div>
      <p className="sa-muted">
        Facility administrators and operators use the{" "}
        <a href="/operator/login">facility Viewer</a>.
      </p>
    </main>
  );
}
