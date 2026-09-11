/* Bounded, dry-run-by-default cutover through the existing audited PII adapter.
 * Run from apps/api after build. Stop workers during a production cutover.
 * node scripts/protect-delivery-snapshots.cjs --tenant UUID --actor UUID [--apply]
 * No provider, invitation credential generation, or scheduling is invoked. */
require('reflect-metadata');
require('dotenv').config();
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { PrismaModule } = require('../dist/src/prisma/prisma.module');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const { ProtectedIdentityModule } = require('../dist/src/modules/protected-identity/protected-identity.module');
const { ProtectedSnapshotsService } = require('../dist/src/modules/protected-identity/protected-snapshots.service');
async function main() {
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  const tenant = args.includes('--tenant') ? value('--tenant') : '';
  const actor = args.includes('--actor') ? value('--actor') : '';
  if (![tenant, actor].every(v => /^[0-9a-f-]{36}$/i.test(v))) throw Error('Explicit tenant and authorized actor UUIDs are required.');
  if (args.some((a, i) => !['--tenant', '--actor', '--apply'].includes(a) && !['--tenant', '--actor'].includes(args[i - 1]))) throw Error('Unsupported argument.');
  class CutoverContext {}
  Module({ imports: [PrismaModule, ProtectedIdentityModule] })(CutoverContext);
  const app = await NestFactory.createApplicationContext(CutoverContext, { logger: false });
  try {
    const prisma = app.get(PrismaService), snapshots = app.get(ProtectedSnapshotsService);
    const notifications = await prisma.incidentNotification.findMany({ where: { incident: { facilityId: tenant }, protectedSnapshotId: null, status: { not: 'SENDING' } }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' }, take: 100 });
    const invitations = await prisma.accountInvitationDelivery.findMany({ where: { facilityId: tenant, purpose: 'LEGACY_INVITATION', protectedSnapshotId: null, status: { not: 'SENDING' } }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' }, take: 100 });
    const counts = { READY: 0, PROTECTED: 0, ALREADY_PROTECTED: 0 };
    for (const [kind, rows] of [['NOTIFICATION_SNAPSHOT', notifications], ['INVITATION_SNAPSHOT', invitations]]) {
      for (const row of rows) {
        const result = await snapshots.backfill(actor, tenant, kind, row.id, row.updatedAt, args.includes('--apply'));
        counts[result.status]++;
      }
    }
    const remaining = await prisma.incidentNotification.count({ where: { incident: { facilityId: tenant }, protectedSnapshotId: null } }) + await prisma.accountInvitationDelivery.count({ where: { facilityId: tenant, purpose: 'LEGACY_INVITATION', protectedSnapshotId: null } });
    console.log(JSON.stringify({ apply: args.includes('--apply'), counts, remaining, batchLimit: 100 }));
  } finally { await app.close(); }
}
main().catch(() => { console.error('Protected snapshot cutover failed. Verify tenant grants, service actor configuration and source eligibility. No plaintext diagnostic is emitted.'); process.exitCode = 1; });
