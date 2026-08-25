CREATE TABLE "TaskUserStatus" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskUserStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskUserStatus_taskId_userId_key" ON "TaskUserStatus"("taskId", "userId");
CREATE INDEX "TaskUserStatus_taskId_idx" ON "TaskUserStatus"("taskId");
CREATE INDEX "TaskUserStatus_userId_idx" ON "TaskUserStatus"("userId");

ALTER TABLE "TaskUserStatus" ADD CONSTRAINT "TaskUserStatus_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskUserStatus" ADD CONSTRAINT "TaskUserStatus_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;