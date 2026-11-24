/**
 * The Community destination (plan P3): the registry's published
 * templates, with All and Saved filter chips carrying their counts.
 * Replaces the list view's Community and Saved tabs.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommunityTemplate } from "@/api";
import { PageHeader } from "@/components/page-header";
import {
  CommunityList,
  type CommunityRowActions,
} from "@/components/community";
import { Button } from "@/components/ui/button";

export function CommunityScreen({
  rows,
  actions,
}: {
  rows: CommunityTemplate[];
  actions: CommunityRowActions;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "saved">("all");
  const saved = rows.filter((row) => row.saved);
  const shown = filter === "all" ? rows : saved;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("nav.community")}>
        <div className="flex gap-2">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            {t("community.filter_all")}
            <span aria-hidden="true"> ({rows.length})</span>
          </Button>
          <Button
            variant={filter === "saved" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("saved")}
          >
            {t("community.filter_saved")}
            <span aria-hidden="true"> ({saved.length})</span>
          </Button>
        </div>
      </PageHeader>

      <CommunityList
        title={
          filter === "all" ? t("nav.community") : t("community.filter_saved")
        }
        note={
          filter === "all" ? t("community.note") : t("community.saved_note")
        }
        rows={shown}
        emptyNote={
          filter === "all"
            ? t("community.empty_note")
            : t("community.saved_empty_note")
        }
        actions={actions}
      />
    </div>
  );
}
