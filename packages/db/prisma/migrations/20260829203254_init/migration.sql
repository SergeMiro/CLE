-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'BANNED');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('USER', 'ORGANIZATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "TonNetwork" AS ENUM ('MAINNET', 'TESTNET');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'ANALYST', 'FINANCE');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('PENDING', 'VERIFYING', 'ACTIVE', 'DEGRADED', 'DISCONNECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MonetizationStatus" AS ENUM ('DISABLED', 'ENABLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('UNKNOWN', 'ACTIVE', 'LEFT', 'BANNED', 'REJOIN_COOLDOWN');

-- CreateEnum
CREATE TYPE "RewardEligibilityStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MembershipEventType" AS ENUM ('JOIN', 'LEAVE', 'REJOIN', 'BAN', 'UNBAN');

-- CreateEnum
CREATE TYPE "MembershipEventSource" AS ENUM ('WEBHOOK', 'ONBOARDING_CHECK', 'SCHEDULED_CHECK', 'WITHDRAWAL_CHECK', 'ADMIN');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('RECEIVED', 'NORMALIZED', 'QUIZ_REQUESTED', 'QUIZ_READY', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuizDifficulty" AS ENUM ('EASY', 'NORMAL', 'HARD', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('STARTED', 'SUBMITTED', 'EXPIRED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "RevenueStatus" AS ENUM ('OBSERVED', 'PENDING', 'CONFIRMED', 'FUNDED', 'DISTRIBUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RevenueCycleStatus" AS ENUM ('DRAFT', 'FUNDED', 'SPLIT', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardCycleStatus" AS ENUM ('DRAFT', 'CALCULATING', 'CALCULATED', 'APPROVED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardPoolType" AS ENUM ('GROWTH', 'LOYALTY', 'REFERRAL', 'LEARNING');

-- CreateEnum
CREATE TYPE "RewardAllocationType" AS ENUM ('GROWTH', 'LOYALTY', 'REFERRAL', 'LEARNING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardAllocationStatus" AS ENUM ('PENDING', 'AVAILABLE', 'CANCELLED', 'PAID');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('PLATFORM_TREASURY', 'ORGANIZATION_TREASURY', 'COMMUNITY_TREASURY', 'CREATOR_BALANCE', 'USER_AVAILABLE', 'USER_PENDING', 'USER_LOCKED', 'REVENUE_SOURCE', 'EXTERNAL_TON');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerTransactionKind" AS ENUM ('REVENUE_FUNDED', 'REVENUE_SPLIT', 'REWARD_PENDING', 'REWARD_UNLOCK', 'REWARD_CANCEL', 'WITHDRAWAL_LOCK', 'WITHDRAWAL_COMPLETE', 'WITHDRAWAL_RELEASE', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WithdrawalSubjectType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'LOCKED', 'PROCESSING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReferralScope" AS ENUM ('PLATFORM', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FraudCaseStatus" AS ENUM ('OPEN', 'REVIEW', 'CLEARED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "telegramFirstName" TEXT,
    "telegramLastName" TEXT,
    "languageCode" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "referralCode" TEXT NOT NULL,
    "referredByUserId" UUID,
    "learningPoints" INTEGER NOT NULL DEFAULT 0,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "userId" UUID,
    "organizationId" UUID,
    "addressRaw" TEXT NOT NULL,
    "addressFriendly" TEXT NOT NULL,
    "network" "TonNetwork" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "invitedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramChannel" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "username" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'PENDING',
    "monetizationStatus" "MonetizationStatus" NOT NULL DEFAULT 'DISABLED',
    "botIsAdmin" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB,
    "missingPermissions" TEXT[],
    "memberCount" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBotInstallation" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "botId" BIGINT NOT NULL,
    "addedByUserId" UUID,
    "permissions" JSONB NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramBotInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CommunityStatus" NOT NULL DEFAULT 'DRAFT',
    "language" TEXT NOT NULL DEFAULT 'en',
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "launchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityLevel" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minDays" INTEGER NOT NULL DEFAULT 0,
    "minPoints" INTEGER NOT NULL DEFAULT 0,
    "weightBps" INTEGER NOT NULL DEFAULT 10000,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "CommunityLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'UNKNOWN',
    "eligibility" "RewardEligibilityStatus" NOT NULL DEFAULT 'PENDING',
    "firstJoinAt" TIMESTAMP(3),
    "currentJoinAt" TIMESTAMP(3),
    "leaveAt" TIMESTAMP(3),
    "rejoinCount" INTEGER NOT NULL DEFAULT 0,
    "loyaltyLevelKey" TEXT,
    "learningPoints" INTEGER NOT NULL DEFAULT 0,
    "quizzesCompleted" INTEGER NOT NULL DEFAULT 0,
    "lastQuizAt" TIMESTAMP(3),
    "referredByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipEvent" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" "MembershipEventType" NOT NULL,
    "telegramStatus" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "MembershipEventSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPolicy" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "maxCreatorShareBps" INTEGER NOT NULL,
    "minWithdrawalNanoton" BIGINT NOT NULL,
    "maxQuizzesPerDay" INTEGER NOT NULL,
    "allowedPoolTypes" TEXT[],
    "minPoolBps" INTEGER NOT NULL DEFAULT 0,
    "maxPoolBps" INTEGER NOT NULL DEFAULT 10000,
    "settings" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenuePolicy" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "creatorShareBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenuePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPolicy" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "growthBps" INTEGER NOT NULL,
    "loyaltyBps" INTEGER NOT NULL,
    "referralBps" INTEGER NOT NULL,
    "learningBps" INTEGER NOT NULL,
    "newMemberHoldDays" INTEGER NOT NULL DEFAULT 7,
    "rejoinCooldownDays" INTEGER NOT NULL DEFAULT 7,
    "referralQualificationDays" INTEGER NOT NULL DEFAULT 30,
    "loyaltyTiers" JSONB NOT NULL,
    "learningMultipliers" JSONB NOT NULL,
    "minRewardNanoton" BIGINT NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizGenerationPolicy" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "QuizMode" NOT NULL DEFAULT 'MANUAL',
    "questionsPerQuiz" INTEGER NOT NULL DEFAULT 3,
    "difficulty" "QuizDifficulty" NOT NULL DEFAULT 'NORMAL',
    "language" TEXT NOT NULL DEFAULT 'en',
    "quizDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyQuizLimit" INTEGER NOT NULL DEFAULT 3,
    "categoriesAllowed" TEXT[],
    "minimumPostLength" INTEGER NOT NULL DEFAULT 200,
    "publishButtonText" TEXT NOT NULL DEFAULT 'START QUIZ',
    "rewardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qualityThreshold" INTEGER NOT NULL DEFAULT 70,
    "pointsPerQuestion" INTEGER NOT NULL DEFAULT 10,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizGenerationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "telegramMessageId" BIGINT NOT NULL,
    "telegramMessageUrl" TEXT,
    "text" TEXT NOT NULL,
    "mediaMetadata" JSONB,
    "language" TEXT,
    "category" TEXT,
    "topics" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'RECEIVED',
    "skipReason" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "contentItemId" UUID,
    "title" TEXT NOT NULL,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "difficulty" "QuizDifficulty" NOT NULL DEFAULT 'NORMAL',
    "language" TEXT NOT NULL DEFAULT 'en',
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "qualityScore" INTEGER,
    "generationMeta" JSONB,
    "publishedMessageId" BIGINT,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "difficulty" "QuizDifficulty" NOT NULL DEFAULT 'NORMAL',
    "basePoints" INTEGER NOT NULL DEFAULT 10,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "explanation" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "QuizOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "rawPoints" INTEGER NOT NULL DEFAULT 0,
    "finalPoints" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "channelId" UUID,
    "communityId" UUID NOT NULL,
    "revenueCycleId" UUID,
    "source" TEXT NOT NULL,
    "amountNanoton" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "RevenueStatus" NOT NULL DEFAULT 'OBSERVED',
    "externalReference" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),

    CONSTRAINT "RevenueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueCycle" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossNanoton" BIGINT NOT NULL DEFAULT 0,
    "platformFeeNanoton" BIGINT NOT NULL DEFAULT 0,
    "creatorShareNanoton" BIGINT NOT NULL DEFAULT 0,
    "communityShareNanoton" BIGINT NOT NULL DEFAULT 0,
    "platformFeeBps" INTEGER NOT NULL,
    "creatorShareBps" INTEGER NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "status" "RevenueCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "fundedAt" TIMESTAMP(3),
    "splitAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardCycle" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "revenueCycleId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "distributableNanoton" BIGINT NOT NULL,
    "allocatedNanoton" BIGINT NOT NULL DEFAULT 0,
    "status" "RewardCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "policySnapshot" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardPool" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "type" "RewardPoolType" NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "amountNanoton" BIGINT NOT NULL,
    "distributedNanoton" BIGINT NOT NULL DEFAULT 0,
    "carriedNanoton" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "RewardPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEligibilitySnapshot" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "membershipStatus" "MembershipStatus" NOT NULL,
    "membershipAgeDays" INTEGER NOT NULL,
    "rejoinCount" INTEGER NOT NULL,
    "growthEligible" BOOLEAN NOT NULL,
    "loyaltyEligible" BOOLEAN NOT NULL,
    "loyaltyWeightBps" INTEGER NOT NULL,
    "referralUnits" INTEGER NOT NULL,
    "learningPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEligibilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAllocation" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "RewardAllocationType" NOT NULL,
    "amountNanoton" BIGINT NOT NULL,
    "weight" BIGINT NOT NULL DEFAULT 0,
    "sourceUnits" BIGINT NOT NULL DEFAULT 0,
    "status" "RewardAllocationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'platform',
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "kind" "LedgerTransactionKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountNanoton" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "balanceNanoton" BIGINT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" UUID NOT NULL,
    "subjectType" "WithdrawalSubjectType" NOT NULL,
    "userId" UUID,
    "organizationId" UUID,
    "walletId" UUID NOT NULL,
    "amountNanoton" BIGINT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "txHash" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "network" "TonNetwork" NOT NULL,
    "txHash" TEXT,
    "rawResponse" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "scope" "ReferralScope" NOT NULL,
    "communityId" UUID,
    "communityKey" TEXT NOT NULL,
    "referrerUserId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "communityId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSignal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCase" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "FraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_referredByUserId_idx" ON "User"("referredByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_organizationId_idx" ON "Wallet"("organizationId");

-- CreateIndex
CREATE INDEX "Wallet_addressRaw_idx" ON "Wallet"("addressRaw");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_addressRaw_network_ownerType_userId_organizationId_key" ON "Wallet"("addressRaw", "network", "ownerType", "userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_ownerUserId_idx" ON "Organization"("ownerUserId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChannel_telegramChatId_key" ON "TelegramChannel"("telegramChatId");

-- CreateIndex
CREATE INDEX "TelegramChannel_organizationId_status_idx" ON "TelegramChannel"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TelegramBotInstallation_channelId_installedAt_idx" ON "TelegramBotInstallation"("channelId", "installedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_channelId_key" ON "Community"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE INDEX "Community_organizationId_status_idx" ON "Community"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityLevel_communityId_key_key" ON "CommunityLevel"("communityId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityLevel_communityId_sortOrder_key" ON "CommunityLevel"("communityId", "sortOrder");

-- CreateIndex
CREATE INDEX "CommunityMember_communityId_status_idx" ON "CommunityMember"("communityId", "status");

-- CreateIndex
CREATE INDEX "CommunityMember_userId_idx" ON "CommunityMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_communityId_userId_key" ON "CommunityMember"("communityId", "userId");

-- CreateIndex
CREATE INDEX "MembershipEvent_memberId_occurredAt_idx" ON "MembershipEvent"("memberId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPolicy_version_key" ON "PlatformPolicy"("version");

-- CreateIndex
CREATE INDEX "PlatformPolicy_effectiveAt_idx" ON "PlatformPolicy"("effectiveAt");

-- CreateIndex
CREATE INDEX "RevenuePolicy_communityId_effectiveFrom_idx" ON "RevenuePolicy"("communityId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RevenuePolicy_communityId_version_key" ON "RevenuePolicy"("communityId", "version");

-- CreateIndex
CREATE INDEX "RewardPolicy_communityId_effectiveFrom_idx" ON "RewardPolicy"("communityId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPolicy_communityId_version_key" ON "RewardPolicy"("communityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuizGenerationPolicy_communityId_version_key" ON "QuizGenerationPolicy"("communityId", "version");

-- CreateIndex
CREATE INDEX "ContentItem_communityId_publishedAt_idx" ON "ContentItem"("communityId", "publishedAt");

-- CreateIndex
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_channelId_telegramMessageId_key" ON "ContentItem"("channelId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "Quiz_communityId_status_idx" ON "Quiz"("communityId", "status");

-- CreateIndex
CREATE INDEX "Quiz_status_availableFrom_idx" ON "Quiz"("status", "availableFrom");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_quizId_sortOrder_key" ON "QuizQuestion"("quizId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuizOption_questionId_sortOrder_key" ON "QuizOption"("questionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_idempotencyKey_key" ON "QuizAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_submittedAt_idx" ON "QuizAttempt"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_communityId_submittedAt_idx" ON "QuizAttempt"("communityId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_userId_key" ON "QuizAttempt"("quizId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_attemptId_questionId_key" ON "QuizAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueEntry_externalReference_key" ON "RevenueEntry"("externalReference");

-- CreateIndex
CREATE INDEX "RevenueEntry_communityId_status_idx" ON "RevenueEntry"("communityId", "status");

-- CreateIndex
CREATE INDEX "RevenueEntry_status_periodStart_idx" ON "RevenueEntry"("status", "periodStart");

-- CreateIndex
CREATE INDEX "RevenueCycle_status_idx" ON "RevenueCycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueCycle_communityId_periodStart_periodEnd_key" ON "RevenueCycle"("communityId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCycle_revenueCycleId_key" ON "RewardCycle"("revenueCycleId");

-- CreateIndex
CREATE INDEX "RewardCycle_communityId_status_idx" ON "RewardCycle"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardPool_cycleId_type_key" ON "RewardPool"("cycleId", "type");

-- CreateIndex
CREATE INDEX "RewardEligibilitySnapshot_cycleId_idx" ON "RewardEligibilitySnapshot"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEligibilitySnapshot_cycleId_userId_key" ON "RewardEligibilitySnapshot"("cycleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAllocation_idempotencyKey_key" ON "RewardAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardAllocation_userId_status_idx" ON "RewardAllocation"("userId", "status");

-- CreateIndex
CREATE INDEX "RewardAllocation_communityId_status_idx" ON "RewardAllocation"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAllocation_cycleId_userId_type_key" ON "RewardAllocation"("cycleId", "userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_type_ownerId_key" ON "LedgerAccount"("type", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reference_key" ON "LedgerTransaction"("reference");

-- CreateIndex
CREATE INDEX "LedgerTransaction_kind_createdAt_idx" ON "LedgerTransaction"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_accountId_asOf_idx" ON "BalanceSnapshot"("accountId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_idempotencyKey_key" ON "Withdrawal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_status_idx" ON "Withdrawal"("userId", "status");

-- CreateIndex
CREATE INDEX "Withdrawal_organizationId_status_idx" ON "Withdrawal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- CreateIndex
CREATE INDEX "Payout_withdrawalId_idx" ON "Payout"("withdrawalId");

-- CreateIndex
CREATE INDEX "Referral_referrerUserId_status_idx" ON "Referral"("referrerUserId", "status");

-- CreateIndex
CREATE INDEX "Referral_communityId_status_idx" ON "Referral"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_scope_communityKey_referredUserId_key" ON "Referral"("scope", "communityKey", "referredUserId");

-- CreateIndex
CREATE INDEX "AIUsage_organizationId_createdAt_idx" ON "AIUsage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_communityId_createdAt_idx" ON "AIUsage"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_userId_createdAt_idx" ON "FraudSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_type_createdAt_idx" ON "FraudSignal"("type", "createdAt");

-- CreateIndex
CREATE INDEX "FraudCase_status_openedAt_idx" ON "FraudCase"("status", "openedAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChannel" ADD CONSTRAINT "TelegramChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotInstallation" ADD CONSTRAINT "TelegramBotInstallation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBotInstallation" ADD CONSTRAINT "TelegramBotInstallation_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityLevel" ADD CONSTRAINT "CommunityLevel_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipEvent" ADD CONSTRAINT "MembershipEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CommunityMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenuePolicy" ADD CONSTRAINT "RevenuePolicy_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardPolicy" ADD CONSTRAINT "RewardPolicy_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizGenerationPolicy" ADD CONSTRAINT "QuizGenerationPolicy_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizOption" ADD CONSTRAINT "QuizOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuizOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TelegramChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEntry" ADD CONSTRAINT "RevenueEntry_revenueCycleId_fkey" FOREIGN KEY ("revenueCycleId") REFERENCES "RevenueCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueCycle" ADD CONSTRAINT "RevenueCycle_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardCycle" ADD CONSTRAINT "RewardCycle_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardCycle" ADD CONSTRAINT "RewardCycle_revenueCycleId_fkey" FOREIGN KEY ("revenueCycleId") REFERENCES "RevenueCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardPool" ADD CONSTRAINT "RewardPool_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "RewardCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEligibilitySnapshot" ADD CONSTRAINT "RewardEligibilitySnapshot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "RewardCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEligibilitySnapshot" ADD CONSTRAINT "RewardEligibilitySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAllocation" ADD CONSTRAINT "RewardAllocation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "RewardCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAllocation" ADD CONSTRAINT "RewardAllocation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAllocation" ADD CONSTRAINT "RewardAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCase" ADD CONSTRAINT "FraudCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
