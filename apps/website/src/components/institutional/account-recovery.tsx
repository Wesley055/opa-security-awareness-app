"use client";
import { useEffect, useState } from "react";
import { ActionForm } from "./action-form";
import { operationStore } from "@/lib/canonical-operations";
type Account = {
  id: string;
  displayIdentity: string;
  role: string;
  accountStatus: string;
  isActive: boolean;
  membershipState: string;
  facility: { name: string } | null;
  supportEmployment: { state: string } | null;
};
export function AccountRecovery({
  transport,
  store,
  blocked,
  onSuccess,
}: {
  transport: (path: string, init?: RequestInit) => Promise<Response>;
  store: ReturnType<typeof operationStore>;
  blocked: string;
  onSuccess: () => void;
}) {
  const [page, setPage] = useState<{
    accounts: Account[];
    nextCursor: string | null;
  } | null>(null);
  const [cursor, setCursor] = useState(""),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [previousBlocked, setPreviousBlocked] = useState(blocked);
  if (previousBlocked !== blocked) {
    setPreviousBlocked(blocked);
    if (blocked) {
      setPage(null);
      setSelected("");
    }
  }
  useEffect(() => {
    let alive = true;
    if (blocked) return;
    void transport("support/accounts" + (cursor ? "?cursor=" + cursor : ""))
      .then(async (response) => {
        if (!response.ok) throw Error();
        const result = await response.json();
        if (!Array.isArray(result.accounts)) throw Error();
        if (alive) {
          setPage(result);
          setNotice("");
        }
      })
      .catch(() => {
        if (alive) {
          setPage(null);
          setNotice(
            "Account directory unavailable. Retry; recovery is disabled until records are confirmed.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [transport, cursor, blocked, revision]);
  const account = !blocked
    ? page?.accounts.find((a) => a.id === selected)
    : undefined;
  return (
    <section>
      <h2>Reviewed account recovery</h2>
      <p>
        Identify the person using their masked name, account label, facility and
        role. Contact details remain protected. If uncertain, stop and verify
        through your approved support case.
      </p>
      <label>
        Filter this page by masked identity, facility, role or status
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected("");
          }}
        />
      </label>
      <label>
        Account to recover
        <select
          value={account?.id ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a person</option>
          {(!blocked ? page?.accounts : [])
            ?.filter((a) =>
              [
                a.displayIdentity,
                a.role.replaceAll("_", " "),
                a.facility?.name,
                a.accountStatus,
                a.membershipState,
                a.supportEmployment?.state,
              ]
                .join(" ")
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayIdentity} · {a.role.replaceAll("_", " ")} ·{" "}
                {a.facility?.name ?? "OPA workforce / no facility"} ·{" "}
                {a.accountStatus} ·{" "}
                {a.supportEmployment?.state ?? a.membershipState}
              </option>
            ))}
        </select>
      </label>
      <p role="status">
        {blocked ||
          notice ||
          (!page
            ? "Retrieving account directory…"
            : page.accounts.length
              ? "Directory loaded. Filters apply to this page; use Next page for more accounts."
              : "No accounts on this page.")}
      </p>
      <button
        type="button"
        onClick={() => {
          setPage(null);
          setSelected("");
          setRevision((v) => v + 1);
        }}
      >
        Refresh account directory
      </button>
      <button
        type="button"
        disabled={!cursor}
        onClick={() => {
          setPage(null);
          setSelected("");
          setCursor("");
        }}
      >
        First page
      </button>
      <button
        type="button"
        disabled={!page?.nextCursor}
        onClick={() => {
          setCursor(page?.nextCursor ?? "");
          setPage(null);
          setSelected("");
        }}
      >
        Next page
      </button>
      <p>
        Next page is available only when more accounts exist. First page is
        available after paging forward.
      </p>
      {account && (
        <article>
          <h3>{account.displayIdentity}</h3>
          <p>
            Account: {account.accountStatus};{" "}
            {account.isActive ? "enabled" : "suspended"}. Membership:{" "}
            {account.membershipState}. Employment:{" "}
            {account.supportEmployment?.state ?? "Not applicable"}.
          </p>
          <details>
            <summary>Details / audit reference</summary>
            {account.id}
          </details>
        </article>
      )}
      <ActionForm
        key={account?.id ?? "none"}
        title="Recover accepted account"
        owner={"recover:" + (account?.id ?? "")}
        path={"support/accounts/" + (account?.id ?? "") + "/recover"}
        store={store}
        prerequisite={
          blocked ||
          (!account
            ? "Select and review an intended account."
            : account.accountStatus !== "ACTIVE"
              ? "Complete the normal verification-first enrollment for pending accounts; recovery cannot bypass enrollment."
              : "")
        }
        confirmation
        onSuccess={() => {
          setRevision((v) => v + 1);
          onSuccess();
        }}
      />
      <p>
        Recovery invalidates credentials and sessions. It does not restore
        employment, assignment or membership authority. History is retained.
      </p>
    </section>
  );
}
