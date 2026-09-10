import { CreateFacility } from "../../../workspace";
export default function Page() {
  return (
    <>
      <div className="sa-eyebrow" style={{ marginTop: 32 }}>
        Platform administration
      </div>
      <h1>Create a facility</h1>
      <p>
        Register a facility using the existing platform provisioning service.
      </p>
      <CreateFacility />
    </>
  );
}
