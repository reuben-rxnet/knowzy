-- 0010 — departments and roles, and questions filed under them
--
-- Requested directly: "I need to be able to add new Departments and Roles too,
-- so that each question can be mapped to Department, Role, Domain, Topic."
--
-- Three decisions this migration encodes:
--
--   * `job_role`, NOT `role`. `role` is already the RBAC role, with
--     `role_permission` and `user_role` beside it. Two different concepts
--     sharing one name in one schema is how a permission check ends up reading
--     an org chart. The UI still says "Role", which is what a person calls it.
--
--   * The mapping columns are NULLABLE. Every question drafted before today has
--     no department and no role, and a NOT NULL column would have meant either
--     inventing values for them or refusing to migrate. A question carries the
--     axes it was filed under, or honestly carries none.
--
--   * The published projection gets its OWN copy of both ids rather than
--     joining back to the draft — the same reason it copies the section hash.
--     Re-filing a draft next year must not silently restate what was published
--     last year.
--
-- A department is NOT a security boundary. Authorization remains roles and
-- DataScope; these are labels for filing and reporting.

-- AlterTable
ALTER TABLE "draft_question" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "job_role_id" UUID;

-- AlterTable
ALTER TABLE "generation_job" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "job_role_id" UUID;

-- AlterTable
ALTER TABLE "published_question_reference" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "job_role_id" UUID;

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "modified_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_role" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_user_id" UUID,
    "modified_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "job_role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_code_key" ON "department"("code");

-- CreateIndex
CREATE INDEX "department_is_active_idx" ON "department"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "job_role_code_key" ON "job_role"("code");

-- CreateIndex
CREATE INDEX "job_role_is_active_idx" ON "job_role"("is_active");

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_question" ADD CONSTRAINT "draft_question_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_question" ADD CONSTRAINT "draft_question_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_question_reference" ADD CONSTRAINT "published_question_reference_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_question_reference" ADD CONSTRAINT "published_question_reference_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

