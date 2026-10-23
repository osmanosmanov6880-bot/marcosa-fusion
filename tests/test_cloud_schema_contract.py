"""R10 *static* SQL preflight. Not a live Postgres/RLS security certification.

The connected Supabase project list was empty on 2026-10-24.
Before any actual deployment run SQL integration tests with separate users,
JWTs, privileges, and Supabase advisors in a brand-new isolated database.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "infra" / "supabase" / "r10_cloud_schema_review_only.sql"


class CloudSchemaReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8")
        cls.clean = re.sub(r"--[^\n]*", "", cls.sql).lower()

    def test_not_live_and_production_bypass_guard(self):
        self.assertIn("NOT APPLIED TO ANY DATABASE", self.sql)
        self.assertIn("manual SQL review", self.sql)
        self.assertNotIn("service_role =", self.clean)
        self.assertNotIn("security definer", self.clean)
        self.assertNotIn("raw_user_meta_data", self.clean)
        self.assertNotIn("auth.role()", self.clean)
        self.assertNotIn("disable row level security", self.clean)

    def test_every_exposed_table_has_rls(self):
        for name in (
            "marcosa_cloud_projects_r10",
            "marcosa_cloud_revisions_r10",
            "marcosa_review_submissions_r10",
        ):
            self.assertRegex(
                self.clean,
                rf"alter\s+table\s+public\.{name}\s+enable\s+row\s+level\s+security",
            )
            self.assertRegex(
                self.clean,
                rf"revoke\s+all\s+on\s+table\s+public\.{name}\s+from\s+public,\s*anon,\s*authenticated",
            )
        self.assertIn(
            "alter table marcosa_private.marcosa_moderation_decisions_r10 enable row level security",
            self.clean,
        )
        self.assertIn("revoke all on schema marcosa_private from public, anon, authenticated", self.clean)

    def test_owner_is_checked_for_every_row_operation(self):
        self.assertEqual(self.clean.count("owner_id=(select auth.uid())"), 8)
        self.assertGreaterEqual(self.clean.count("'is_anonymous'"), 8)
        self.assertIn("with check (", self.clean)
        self.assertIn("for update to authenticated", self.clean)
        self.assertIn("for insert to authenticated", self.clean)
        self.assertIn("for select to authenticated", self.clean)
        self.assertNotIn("to anon", self.clean)
        self.assertNotIn("grant delete", self.clean)

    def test_immutable_author_revisions_no_browser_publishing(self):
        self.assertIn("grant insert (project_id,revision_number,story)", self.clean)
        self.assertIn("grant insert (project_id,revision_id,self_checklist)", self.clean)
        self.assertIn("grant update (title)", self.clean)
        self.assertNotIn("grant update (story)", self.clean)
        self.assertNotIn("grant update (decision)", self.clean)
        self.assertNotIn("grant update (owner_id)", self.clean)
        self.assertNotIn("for update to authenticated\n", self.clean.split(
            "create policy r10_owner_revision_select", 1
        )[-1])
        self.assertIn("marcosa_private.marcosa_moderation_decisions_r10", self.clean)
        self.assertNotRegex(
            self.clean,
            r"grant\s+.*\s+on\s+(?:table\s+)?marcosa_private\."
            r"marcosa_moderation_decisions_r10\s+to\s+(?:anon|authenticated)",
        )

    def test_strict_story_checks_and_composite_owner_foreign_keys(self):
        for s in (
            "story->>'schema'='marcosa-original-story/v1'",
            "story->>'status'='draft_only'",
            "story->>'publication_state'='not_published'",
            "story->>'rights_independently_verified'='false'",
            "story->>'manual_approval'='false'",
            "story->>'tracking'='false'",
            "story->>'payments'='false'",
            "jsonb_array_length(story->'branches')=2",
            "jsonb_array_length(story->'endings')=4",
            "octet_length(story::text) <= 131072",
            "foreign key (project_id,owner_id)",
            "foreign key (revision_id,project_id,owner_id)",
            "on delete restrict",
        ):
            self.assertIn(s, self.clean)
        self.assertIn(
            """self_checklist = '{"authorship":true,"sponsorship":true,"editorial":true,"privacy":true}'::jsonb""",
            self.clean,
        )


if __name__ == "__main__":
    unittest.main()
