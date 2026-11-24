/**
 * M3 — the new-template control. On the PC the header shows a split
 * button: the main half opens the format chooser, the chevron starts a
 * scene or document directly. On the phone the same two actions sit
 * in a small FAB above the bottom nav.
 */
import { useTranslation } from "react-i18next";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { icons } from "@/lib/icons";

export function NewTemplateButton({
  onNew,
  onNewScene,
  onNewDocument,
}: {
  onNew: () => void;
  onNewScene: () => void;
  onNewDocument: () => void;
}) {
  const { t } = useTranslation();
  const items: ActionItem[] = [
    { label: t("app.new_scene"), icon: "templates", onSelect: onNewScene },
    {
      label: t("app.new_document"),
      icon: "unpublish",
      onSelect: onNewDocument,
    },
  ];

  return (
    <>
      <div className="hidden md:flex">
        <Button onClick={onNew} className="rounded-r-none">
          <icons.add aria-hidden="true" className="h-4 w-4" />
          {t("app.new_template")}
        </Button>
        <ActionMenu
          items={items}
          trigger={
            <Button
              variant="default"
              size="icon"
              aria-label={t("common.more")}
              className="rounded-l-none border-l border-primary-foreground/25"
            >
              <icons.chevron_down aria-hidden="true" className="h-4 w-4" />
            </Button>
          }
        />
      </div>
      <div className="fixed right-4 bottom-20 z-30 flex md:hidden">
        <IconButton
          icon="add"
          label={t("app.new_template")}
          className="rounded-r-none"
          onClick={onNew}
        />
        <ActionMenu
          items={items}
          trigger={
            <IconButton
              icon="chevron_down"
              label={t("common.more")}
              className="rounded-l-none border-l border-primary-foreground/25"
            />
          }
        />
      </div>
    </>
  );
}
