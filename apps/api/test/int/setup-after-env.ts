import {
  prismaTest,
  truncateAll,
  prepareTestConnection,
  closePreparedConnections,
} from "./prisma-test-client";

/**
 * Truncation runs before EACH test. Fixtures therefore belong in beforeEach,
 * not beforeAll: a beforeAll fixture would be deleted before the second test
 * in the file ran.
 */
beforeEach(async () => {
  await prepareTestConnection();
  await truncateAll();
});

afterEach(async () => {
  await closePreparedConnections();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});
