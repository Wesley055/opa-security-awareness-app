import type { Metadata } from "next";
import "./super-admin.css";
export const metadata: Metadata = {
  title: "OPA Super Admin",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="sa">{children}</div>;
}
