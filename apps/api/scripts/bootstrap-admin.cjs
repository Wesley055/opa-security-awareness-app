/**
 * ONE-OFF PLATFORM ADMIN BOOTSTRAP.
 *
 * DELIBERATELY NOT AN HTTP ENDPOINT, AND MUST NEVER BECOME ONE. Nothing in
 * the API grants a role; this is the only path, it is manual, and it leaves
 * a printed before/after record in whatever terminal ran it.
 *
 *   npm run bootstrap:admin -- --email=someone@example.com --confirm-admin-bootstrap
 *
 * Contract, all enforced, every failure leaving the database untouched:
 *   - an exact, existing email, matched lowercase as auth.service matches it
 *   - the account must be active, because login() gates on isActive and a
 *     disabled ADMIN is a privilege nobody can see or use
 *   - the current role must be USER, so this can neither re-promote nor
 *     silently demote an ADMIN, RESPONDER or FACILITY_OPERATOR
 *   - the per-user advisory lock is taken before the read that decides
 *   - role is the only column written
 *
 * NOTE ON OUTPUT: this prints the target email and user id. That is the
 * point - it is the operator's record of what changed - but it means the
 * output does not belong in a shared log stream. Run it where you can read
 * the result yourself.
 */

// Prisma's CLI loads .env; PrismaClient does not. Without this the script
// fails on a missing DATABASE_URL, which looks like a database fault rather
// than a wiring one.
try {
  require('dotenv').config();
} catch (error) {
  // dotenv is not a direct dependency of this workspace in every install.
  // If DATABASE_URL is already exported, that is fine; the check below is
  // what actually decides.
}

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function argument(name) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

/**
 * Host and database name only. A connection string carries the password,
 * and this is printed.
 */
function describeDatabase(url) {
  if (!url) {
    return 'UNSET';
  }
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '') || '(none)';
    return parsed.hostname + ':' + (parsed.port || '5432') + '/' + name;
  } catch (error) {
    return 'UNPARSEABLE';
  }
}

const SELECT = {
  id: true,
  email: true,
  role: true,
  facilityId: true,
  isActive: true,
};

async function main() {
  const rawEmail = argument('email');
  const confirmed = process.argv.includes('--confirm-admin-bootstrap');

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. No database change was made.',
    );
  }

  // Printed BEFORE any decision, so an operator who is about to promote
  // someone in the wrong database can see it and stop.
  console.log('target_database=' + describeDatabase(process.env.DATABASE_URL));

  if (!rawEmail) {
    throw new Error(
      'Missing --email=<existing-user-email>. No database change was made.',
    );
  }

  if (!confirmed) {
    throw new Error(
      'Missing --confirm-admin-bootstrap. No database change was made.',
    );
  }

  // auth.service matches on the lowercased email and stores it lowercased,
  // so this must lowercase too or an exact-looking address will miss.
  const email = rawEmail.trim().toLowerCase();

  if (!email) {
    throw new Error('Email is empty. No database change was made.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.user.findUnique({
      where: { email },
      select: SELECT,
    });

    if (!initial) {
      throw new Error(
        'No user exists with email ' + email + '. No database change was made.',
      );
    }

    // The same one-argument per-user lock that incident activation, the
    // lifecycle transitions and the journey session code all take. Nothing
    // else writes User.role today, so this serialises against nothing yet -
    // it is here because facility assignment in 13C-5 will take it, and a
    // lock convention that some writers honour and others do not is worse
    // than none.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.id}))`;

    // Re-read INSIDE the lock. The first lookup exists only to resolve the
    // id needed to take it; the state that the checks below rely on must be
    // read after the lock is held, or the checks are advisory.
    const current = await tx.user.findUnique({
      where: { id: initial.id },
      select: SELECT,
    });

    if (!current) {
      throw new Error(
        'User disappeared between lookup and lock. No database change was made.',
      );
    }

    if (!current.isActive) {
      throw new Error(
        'Refusing promotion: account is not active. login() gates on ' +
          'isActive, so this would create an administrator who cannot log ' +
          'in. No database change was made.',
      );
    }

    if (current.role !== 'USER') {
      throw new Error(
        'Refusing promotion: current role is ' +
          current.role +
          ', expected USER. No database change was made.',
      );
    }

    const updated = await tx.user.update({
      where: { id: current.id },
      data: { role: 'ADMIN' },
      select: SELECT,
    });

    return { before: current, after: updated };
  });

  console.log('probe=bootstrap-admin-result');
  console.log('before=' + JSON.stringify(result.before));
  console.log('after=' + JSON.stringify(result.after));
  console.log('bootstrap_admin_success=true');
}

main()
  .catch((error) => {
    console.error('bootstrap_admin_error=' + error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });