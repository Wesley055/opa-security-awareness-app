import { prismaTest, truncateAll } from './prisma-test-client';

/**
 * Truncation runs before EACH test. Fixtures therefore belong in beforeEach,
 * not beforeAll: a beforeAll fixture would be deleted before the second test
 * in the file ran.
 */
beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});
