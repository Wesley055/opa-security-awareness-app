import "../super-admin/super-admin.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="sa">{children}</div>;
}
