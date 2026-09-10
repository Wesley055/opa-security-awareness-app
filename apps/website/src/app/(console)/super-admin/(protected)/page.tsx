import Workspace from "../workspace";
export default function Page() {
  return (
    <>
      <div className="sa-eyebrow" style={{ marginTop: 32 }}>
        Platform administration
      </div>
      <h1>Facility workspace</h1>
      <p>Manage facilities, institutional access and secure enrollment.</p>
      <Workspace />
    </>
  );
}
