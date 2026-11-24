/**
 * The Templates destination (plan P3): the user's local templates —
 * what the list view's Mine tab held. The recent jobs have their own
 * destination now, and the community's rows live in the Community
 * destination.
 */
import { useTranslation } from "react-i18next";
import type { Publication } from "@/api";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppTemplate } from "@/templates";

export function TemplatesScreen({
  templates,
  publications,
  storageError,
  onNew,
  onPrint,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  templates: AppTemplate[];
  /** This device's publications, keyed by their local template. */
  publications: Publication[];
  /** A local-storage failure, in plain words, if there is one. */
  storageError: string | null;
  onNew: () => void;
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  /** Publish a local template; the App opens the sign-in dialog when
   * the account is not signed in. */
  onPublish: (t: AppTemplate) => void;
  onUnpublish: (t: AppTemplate) => void;
  onDelete: (t: AppTemplate) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("app.title")} description={t("app.tagline")}>
        <Button onClick={onNew}>{t("app.new_template")}</Button>
      </PageHeader>

      <div className="flex flex-col gap-4">
        {templates.map((tpl) => {
          const published = publications.some(
            (p) => p.localTemplateId === tpl.id,
          );
          return (
            <Card key={tpl.id}>
              <CardHeader className="flex-row items-center justify-between max-md:flex-col max-md:items-stretch">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {tpl.name}
                    <Badge
                      variant={tpl.track === "scene" ? "default" : "secondary"}
                    >
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
                <div className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                  {published ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUnpublish(tpl)}
                    >
                      {t("app.unpublish")}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => onPublish(tpl)}>
                      {t("app.publish")}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => onEdit(tpl)}>
                    {t("app.edit")}
                  </Button>
                  <Button onClick={() => onPrint(tpl)}>{t("app.print")}</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={published}
                    title={published ? t("app.delete_blocked") : undefined}
                    onClick={() => onDelete(tpl)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </CardHeader>
            </Card>
          );
        })}
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
