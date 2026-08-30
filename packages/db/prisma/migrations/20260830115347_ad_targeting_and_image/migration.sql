-- Targeting moves from a single column to a list, and a campaign gains an image.
--
-- The generated migration dropped "communityId" outright. It is rewritten here
-- so the table that replaces it is created and filled FIRST: an existing
-- community-scoped campaign keeps running in the community it was sold for
-- instead of silently becoming a platform-wide one.

-- CreateTable
CREATE TABLE "AdvertisementTarget" (
    "advertisementId" UUID NOT NULL,
    "communityId" UUID NOT NULL,

    CONSTRAINT "AdvertisementTarget_pkey" PRIMARY KEY ("advertisementId","communityId")
);

-- CreateIndex
CREATE INDEX "AdvertisementTarget_communityId_idx" ON "AdvertisementTarget"("communityId");

-- AddForeignKey
ALTER TABLE "AdvertisementTarget" ADD CONSTRAINT "AdvertisementTarget_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisementTarget" ADD CONSTRAINT "AdvertisementTarget_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing single-community campaign over to the new table.
INSERT INTO "AdvertisementTarget" ("advertisementId", "communityId")
SELECT "id", "communityId" FROM "Advertisement" WHERE "communityId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Advertisement" DROP CONSTRAINT "Advertisement_communityId_fkey";

-- DropIndex
DROP INDEX "Advertisement_status_scope_communityId_idx";

-- AlterTable
ALTER TABLE "Advertisement" DROP COLUMN "communityId",
ADD COLUMN     "imageUrl" TEXT;

-- CreateIndex
CREATE INDEX "Advertisement_status_scope_idx" ON "Advertisement"("status", "scope");
