import type {
  MembershipResult,
  OperatorMember,
} from '@/lib/operator-membership';

function MemberRow({ member }: { member: OperatorMember }) {
  const name = `${member.firstName} ${member.lastName}`.trim();

  return (
    <li className="rounded-lg border border-line bg-panel-2 px-4 py-3.5">
      <p className="font-display font-bold text-ink">
        {name || 'Unnamed member'}
      </p>
    </li>
  );
}

function MemberGroup({
  title,
  members,
  emptyMessage,
}: {
  title: string;
  members: OperatorMember[];
  emptyMessage: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-bold text-ink">
          {title}
        </h2>

        <span className="font-mono text-xs text-muted">
          {members.length}
        </span>
      </div>

      {members.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Facility membership is reference information, not part of the live queue.
 *
 * It has no polling timer and no client state. Reloading /operator/members
 * obtains a fresh server-rendered roster.
 *
 * isActive, accountStatus and facility.isVerified are deliberately not shown:
 * they are provisioning/standing facts, not the answer to "who belongs to
 * this facility?"
 */
export function FacilityMembership({
  result,
}: {
  result: MembershipResult;
}) {
  if (result.state === 'FORBIDDEN') {
    return (
      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <h1 className="font-display text-2xl font-bold text-ink">
          Facility membership
        </h1>

        <p className="mt-4 max-w-prose text-sm text-ink">
          {result.message}
        </p>
      </section>
    );
  }

  if (result.state === 'UNAVAILABLE') {
    return (
      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <h1 className="font-display text-2xl font-bold text-ink">
          Facility membership
        </h1>

        <p className="mt-4 max-w-prose text-sm text-muted">
          Membership is temporarily unavailable. This page does not know
          whether the roster has changed.
        </p>
      </section>
    );
  }

  if (result.state !== 'READY') {
    return null;
  }

  const { membership } = result;
  const residentCount = membership.residents.length;
  const operatorCount = membership.operators.length;
  const residentLabel = residentCount === 1 ? 'resident' : 'residents';
  const operatorLabel = operatorCount === 1 ? 'operator' : 'operators';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Facility membership
        </h1>

        <p className="mt-2 text-sm text-muted">
          {residentCount} {residentLabel}
          <span aria-hidden="true"> &middot; </span>
          {operatorCount} {operatorLabel}
        </p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <MemberGroup
          title="Operators"
          members={membership.operators}
          emptyMessage="No operators are currently assigned."
        />

        <MemberGroup
          title="Residents"
          members={membership.residents}
          emptyMessage="No residents are currently assigned."
        />
      </div>
    </div>
  );
}
