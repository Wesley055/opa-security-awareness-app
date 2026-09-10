"use client";
import { useState } from "react";
export default function SignOut() {
  const [error, setError] = useState(false);
  return (
    <>
      <button
        className="sa-secondary"
        onClick={async () => {
          try {
            const response = await fetch("/api/super-admin/logout", {
              method: "POST",
            });
            if (!response.ok) throw new Error();
            window.location.assign("/super-admin/login");
          } catch {
            setError(true);
          }
        }}
      >
        Sign out
      </button>
      {error && <span role="alert">Sign-out failed. Try again.</span>}
    </>
  );
}
