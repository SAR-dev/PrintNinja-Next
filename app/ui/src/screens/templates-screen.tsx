/**
 * The Templates destination (plan P3): the user's local templates —
 * what the list view's Mine tab held. The recent jobs have their own
 * destination now, and the community's rows live in the Community
 * destination.
 *
 * P2/D2: each card has one primary action (Print), an icon-only Edit
 * and an overflow menu for the rest; right-click opens that same menu
 * on the PC. New-template is a split button on the PC and a small FAB
 * above the bottom nav on the phone.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Publication } from "@/api";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { NewTemplateButton } from "@/components/new-template-button";
import { PageHeader } from "@/components/page-header";
import { icons } from "@/lib/icons";
import type { AppTemplate } from "@/templates";

interface CardProps {
  tpl: AppTemplate;
  published: boolean;
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  onPublish: (t: AppTemplate) => void;
  onUnpublish: (t: AppTemplate) => void;
  onDuplicate: (t: AppTemplate) => void;
  onDelete: (t: AppTemplate) => void;
}

function TemplateCard({
  tpl,
  published,
  onPrint,
  onEdit,
  onPublish,
  onUnpublish,
  onDuplicate,
  onDelete,
}: CardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const items: ActionItem[] = [
    published
      ? {
          label: t("app.unpublish"),
          icon: "unpublish",
          onSelect: () => onUnpublish(tpl),
        }
      : {
          label: t("app.publish"),
          icon: "publish",
          onSelect: () => onPublish(tpl),
        },
    {
      label: t("app.duplicate"),
      icon: "add",
      onSelect: () => onDuplicate(tpl),
    },
    {
      label: t("common.delete"),
      icon: "delete",
      danger: true,
      disabled: published,
      separator: true,
      onSelect: () => onDelete(tpl),
    },
  ];

  return (
    <Card
      onContextMenu={(e) => {
        // A PC right-click on the card opens the same actions.
        if (window.matchMedia("(pointer: fine)").matches) {
          e.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      <CardHeader className="flex-row items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {tpl.name}
            <Badge variant={tpl.track === "scene" ? "default" : "secondary"}>
              {tpl.track === "scene"
                ? t("app.track_scene")
                : t("app.track_document")}
            </Badge>
            {published && (
              <Badge variant="secondary">{t("app.published")}</Badge>
            )}
          </CardTitle>
          <CardDescription>{tpl.description}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            icon="edit"
            label={t("app.edit")}
            variant="secondary"
            onClick={() => onEdit(tpl)}
          />
          <Button onClick={() => onPrint(tpl)}>
            <icons.print aria-hidden="true" className="h-4 w-4" />
            {t("app.print")}
          </Button>
          <ActionMenu
            items={items}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
        </div>
      </CardHeader>
    </Card>
  );
}

export function TemplatesScreen({
  templates,
  publications,
  storageError,
  onNew,
  onNewScene,
  onNewDocument,
  onPrint,
  onEdit,
  onPublish,
  onUnpublish,
  onDuplicate,
  onDelete,
}: {
  templates: AppTemplate[];
  /** This device's publications, keyed by their local template. */
  publications: Publication[];
  /** A local-storage failure, in plain words, if there is one. */
  storageError: string | null;
  onNew: () => void;
  onNewScene: () => void;
  onNewDocument: () => void;
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  /** Publish a local template; the App opens the sign-in dialog when
   * the account is not signed in. */
  onPublish: (t: AppTemplate) => void;
  onUnpublish: (t: AppTemplate) => void;
  onDuplicate: (t: AppTemplate) => void;
  onDelete: (t: AppTemplate) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6 max-md:pb-16">
      <PageHeader title={t("app.title")} description={t("app.tagline")}>
        <NewTemplateButton
          onNew={onNew}
          onNewScene={onNewScene}
          onNewDocument={onNewDocument}
        />
      </PageHeader>

      <div className="flex flex-col gap-4">
        {templates.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            published={publications.some((p) => p.localTemplateId === tpl.id)}
            onPrint={onPrint}
            onEdit={onEdit}
            onPublish={onPublish}
            onUnpublish={onUnpublish}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        ))}
      </div>

      <div>
        {storageError ? (
          <p className="text-caption text-danger">
            {t("app.local_storage_error", { error: storageError })}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("app.local_storage_note")}
          </p>
        )}
      </div>
    </div>
  );
}
